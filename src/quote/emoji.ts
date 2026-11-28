// ==========================================
// 😀 2. 絵文字のトークン化と画像解決
// ==========================================
// 😀 引用文・表示名に含まれる絵文字を通常テキストと分離し、画像として
// インライン描画するためのモジュール。同梱フォント（M PLUS Rounded 1c /
// Noto Sans JP）には絵文字グリフが無いため、フォント描画では絵文字が
// そのまま欠落する。そこで Twemoji の PNG 画像（72x72）を取得して行内に
// 配置する方式にする。Discord カスタム絵文字（<:name:id> / <a:name:id>）
// は Discord CDN の静止画 PNG を使う。
//
// 取得はアバター取得（avatar.ts）と同じ考え方の防御を適用する:
// 許可ホストのみ・タイムアウト・サイズ上限・Content-Type 確認。
// 取得に失敗した絵文字は、その絵文字だけ元の文字列（テキスト）に戻して
// 描画を続ける（全体を落とさない）。
import { loadImage, type Canvas, type Image } from "@napi-rs/canvas";

// ------------------------------------------
// 🔤 トークン
// ------------------------------------------
export type RichToken =
  | { kind: "text"; text: string }
  // 😀 Unicode 絵文字（raw は元の文字列、asset は Twemoji のファイル名部分）
  | { kind: "emoji"; raw: string; asset: string }
  // 💬 Discord カスタム絵文字
  | { kind: "custom"; raw: string; id: string; animated: boolean };

// 🖼️ 画像解決後のトークン（レイアウト・描画はこちらを使う）
export type ResolvedToken =
  | { kind: "text"; text: string }
  | { kind: "image"; raw: string; image: Image | Canvas };

// ------------------------------------------
// 🔍 絵文字シーケンスの正規表現
// ------------------------------------------
// 📋 対応する並び:
// - Discord カスタム絵文字 <:name:id> / <a:name:id>
// - 国旗（Regional Indicator のペア）
// - キートップ（数字・#・* + 任意の VS16 + U+20E3）
// - Extended_Pictographic を基底とする並び（VS16・肌色修飾・タグ文字を
//   任意で伴い、ZWJ で連結したものを含む）
// 数字・#・* 単体は通常テキストとして残す（Discord の表示に合わせる）。
// 基底文字の判定は Twemoji の扱いに準じ、VS16 の無い単体絵文字も
// 絵文字として扱う。
const VS16 = "\uFE0F";
const ZWJ = "\u200D";
const SKIN_TONE = String.raw`[\u{1F3FB}-\u{1F3FF}]`;
const TAG_CHARS = String.raw`[\u{E0020}-\u{E007E}]`;
const EMOJI_UNIT =
  String.raw`(?:\p{Extended_Pictographic})` +
  `(?:${VS16}|${SKIN_TONE}){0,2}` +
  `(?:${TAG_CHARS}*\u{E007F})?`;
const EMOJI_SEQUENCE_RE = new RegExp(
  String.raw`<(a)?:[A-Za-z0-9_]{2,32}:(\d+)>` +
    String.raw`|[\u{1F1E6}-\u{1F1FF}]{2}` +
    `|[0-9#*]${VS16}?\u{20E3}` +
    `|${EMOJI_UNIT}(?:${ZWJ}${EMOJI_UNIT})*`,
  "gu",
);

// ------------------------------------------
// 🖼️ Twemoji のアセット名
// ------------------------------------------
// 📄 Twemoji のファイル名規則: コードポイントを16進で "-" 連結し、
// ZWJ を含まない並びでは U+FE0F を落とす。ZWJ を含む並びでは残す。
// （例: ❤️→2764 / 1️⃣→31-20e3 / 🏳️‍🌈→1f3f3-fe0f-200d-1f308）
// 取得失敗時の予備として、規則を反転した候補も返す。
export function twemojiAssetCandidates(raw: string): string[] {
  const codePoints = [...raw].map((ch) => ch.codePointAt(0)!.toString(16));
  const withVs16 = codePoints.join("-");
  const withoutVs16 = codePoints.filter((cp) => cp !== "fe0f").join("-");
  const primary = codePoints.includes("200d") ? withVs16 : withoutVs16;
  const secondary = primary === withVs16 ? withoutVs16 : withVs16;
  return primary === secondary ? [primary] : [primary, secondary];
}

// 🔗 Twemoji 画像の URL を作る
export function twemojiUrl(asset: string): string {
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${asset}.png`;
}

// 🔗 Discord カスタム絵文字の画像 URL を作る
export function customEmojiUrl(id: string): string {
  return `https://cdn.discordapp.com/emojis/${id}.png?size=96`;
}

// ------------------------------------------
// ✂️ トークン化
// ------------------------------------------
// ✂️ テキストを通常テキストと絵文字に分割する。絵文字を含まない場合は
// text トークン1つだけを返す（呼び出し側の旧経路判定に使う）。
export function tokenizeRichText(text: string): RichToken[] {
  const tokens: RichToken[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(EMOJI_SEQUENCE_RE)) {
    const raw = match[0];
    const index = match.index;
    if (index > lastIndex) {
      tokens.push({ kind: "text", text: text.slice(lastIndex, index) });
    }
    if (match[2] !== undefined) {
      tokens.push({
        kind: "custom",
        raw,
        id: match[2],
        animated: match[1] === "a",
      });
    } else {
      tokens.push({
        kind: "emoji",
        raw,
        asset: twemojiAssetCandidates(raw)[0],
      });
    }
    lastIndex = index + raw.length;
  }
  if (lastIndex < text.length) {
    tokens.push({ kind: "text", text: text.slice(lastIndex) });
  }
  if (tokens.length === 0) {
    tokens.push({ kind: "text", text });
  }
  return tokens;
}

// 🔍 絵文字トークンを含んでいるかどうか
export function hasEmojiToken(tokens: RichToken[]): boolean {
  return tokens.some((t) => t.kind !== "text");
}

// ------------------------------------------
// 📥 画像の取得（防御つき）と解決
// ------------------------------------------
// 📦 絵文字画像1枚のサイズ上限（1MB）
export const MAX_EMOJI_BYTES = 1024 * 1024;
const ALLOWED_EMOJI_HOSTS = new Set(["cdn.jsdelivr.net", "cdn.discordapp.com"]);
const EMOJI_FETCH_TIMEOUT_MS = 5_000;

export type EmojiImageLoader = (url: string) => Promise<Image | Canvas | null>;

// 🔍 URL が取得許可先（https + 許可ホスト）かどうか
export function isAllowedEmojiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" && ALLOWED_EMOJI_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

// 💾 取得結果のキャッシュ（同じ絵文字の再取得を避ける）。失敗（null）も
// キャッシュし、連続使用時の無駄な再試行を抑える。
const emojiImageCache = new Map<string, Image | null>();
const MAX_EMOJI_CACHE_ENTRIES = 256;

// 📥 絵文字画像を取得する（キャッシュつき、失敗したら null）
export async function fetchEmojiImage(url: string): Promise<Image | null> {
  const cached = emojiImageCache.get(url);
  if (cached !== undefined) return cached;
  let result: Image | null = null;
  try {
    if (isAllowedEmojiUrl(url)) {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(EMOJI_FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        const contentLength = res.headers.get("content-length");
        const declared = contentLength === null ? NaN : Number(contentLength);
        const contentType = res.headers.get("content-type");
        if (
          !(Number.isFinite(declared) && declared > MAX_EMOJI_BYTES) &&
          (contentType === null || contentType.startsWith("image/"))
        ) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength <= MAX_EMOJI_BYTES) {
            result = await loadImage(buf);
          }
        }
      }
    }
  } catch {
    result = null;
  }
  if (emojiImageCache.size >= MAX_EMOJI_CACHE_ENTRIES) {
    const oldest = emojiImageCache.keys().next().value;
    if (oldest !== undefined) emojiImageCache.delete(oldest);
  }
  emojiImageCache.set(url, result);
  return result;
}

// 🖼️ トークン列の絵文字を画像に解決する。取得できなかった絵文字は
// 元の文字列のテキストトークンに戻す（その絵文字だけ代替表示）。
export async function resolveRichTokens(
  tokens: RichToken[],
  loader: EmojiImageLoader = fetchEmojiImage,
): Promise<ResolvedToken[]> {
  const resolved: ResolvedToken[] = [];
  for (const token of tokens) {
    if (token.kind === "text") {
      resolved.push(token);
      continue;
    }
    let image: Image | Canvas | null = null;
    if (token.kind === "custom") {
      image = await loader(customEmojiUrl(token.id));
    } else {
      for (const asset of twemojiAssetCandidates(token.raw)) {
        image = await loader(twemojiUrl(asset));
        if (image) break;
      }
    }
    if (image) {
      resolved.push({ kind: "image", raw: token.raw, image });
    } else {
      resolved.push({ kind: "text", text: token.raw });
    }
  }
  return resolved;
}
