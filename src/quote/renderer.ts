// ==========================================
// 🖼️ 4. 名言画像レンダラ（@napi-rs/canvas）
// ==========================================
// 🖼️ 本家 Make It a Quote の出力形式に寄せたレイアウト:
// 左にグレースケールのアバター写真（右へ向けて黒にフェード）、
// 右側に M PLUS Rounded 1c の引用文を中央寄せで置き、その下に
// 「- 表示名」と「@ユーザー名」を続ける。1200x630、モノクロ基調。
//
// 🎯 描画バリアントが2つある:
// - "exact": 本家完全一致の高精度版（色・配置・フェード・グレースケール
//   係数まで本家の実画像との比較で実測した値）
// - "standard": 本家と見分けがつく従来版（クレジットに Bot 自身のタグ）
// exact は悪用防止のため、index.ts のゲート（実発言の右クリック経路
// かつ許可されたユーザー本人のときだけ）を通った場合にのみ使われる。
// 未指定時は standard に倒す。
import {
  createCanvas,
  GlobalFonts,
  type Canvas,
  type Image,
} from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchEmojiImage,
  hasEmojiToken,
  resolveRichTokens,
  tokenizeRichText,
  type EmojiImageLoader,
  type ResolvedToken,
} from "./emoji.js";
import {
  fitQuoteText,
  fitRichText,
  measureRichLine,
  type MeasureFn,
} from "./wrap.js";

// ------------------------------------------
// 📐 レイアウト定数
// ------------------------------------------
export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 630;

const BG = "#000000";
const TEXT = "#f7f5f0";
const NAME_TEXT = "#efefef";
const SUB_TEXT = "#a3a3ab";
const CREDIT = "#6f6f76";

const AVATAR_WIDTH = 640; // アバター領域（左端から）。右端はフェードで隠れる
const TEXT_WIDTH = 596; // 本文の最大幅（564..1160）
const QUOTE_MAX_HEIGHT = 372; // 引用文ブロックの最大の高さ

const MAIN = "QuoteMain"; // M PLUS Rounded 1c（引用文・発言者名。本家のデフォルト font=mplus に合わせる）
const SANS = "NotoJP"; // Noto Sans JP（クレジット・代替アバター）
let fontsReady = false;

// 📁 assets/fonts の場所を探す。コンパイル後（dist/src/quote/）と
// ソース直下（src/quote/）で階層が変わるため、上方向に辿って探す。
function findFontsDir(): string {
  let dir = fileURLToPath(new URL(".", import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "assets", "fonts");
    if (existsSync(join(candidate, "NotoSansJP-Regular.ttf"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    "フォントが見つかりません: assets/fonts/NotoSansJP-Regular.ttf",
  );
}

// 🔤 フォント登録（初回のみ）。
// 登録に失敗したまま描画すると文字化け（豆腐）になるため、失敗は例外にする。
export function ensureFonts(): void {
  if (fontsReady) return;
  const dir = findFontsDir();
  const main = GlobalFonts.registerFromPath(
    join(dir, "MPLUSRounded1c-Regular.ttf"),
    MAIN,
  );
  const sans = GlobalFonts.registerFromPath(
    join(dir, "NotoSansJP-Regular.ttf"),
    SANS,
  );
  if (!main || !sans) {
    throw new Error(`フォントの登録に失敗しました: ${dir}`);
  }
  fontsReady = true;
}

// ------------------------------------------
// 📥 入力
// ------------------------------------------
export interface QuoteImageInput {
  // 💬 引用文（捏造でも実発言でもよい）
  text: string;
  // 👤 表示名（グローバル表示名）
  displayName: string;
  // 🏷️ @ に続くユーザー名
  username: string;
  // 🖼️ アバター画像（取得できなかった場合は fallbackAvatar で作った Canvas）
  avatar: Image | Canvas;
  // 😀 絵文字画像の取得関数（テスト用の差し替え口。通常は fetchEmojiImage）
  emojiImageLoader?: EmojiImageLoader;
  // 🎯 描画バリアント: "exact" = 本家完全一致の高精度版、
  // "standard" = 本家と見分けがつく従来版。未指定時は standard
  // （高精度版は明示した経路でのみ使う。悪用防止）
  variant?: "exact" | "standard";
  // ©️ standard 時の右下クレジット（Bot 自身のタグ）。
  // exact 時は本家と同一の固定文字列を使う
  credit?: string;
}

// ------------------------------------------
// ⬛ グレースケール化
// ------------------------------------------
// ⬛ アバター領域サイズのオフスクリーンに描き、画素をグレースケール化
// する。ctx.filter に依存しないため、実行環境差の影響を受けない。
// 約40万画素の同期ループがイベントループを占有し続けないよう、行単位の
// チャンクに分けて合間に制御を返す。画素ごとの計算式は変えていないため
// 出力画像は従来と同一になる。残る同期処理（折り返し計測など）は、入力が
// 最大300文字に制限されることで処理量の上限が絞られている（guard.ts）。
const GRAYSCALE_ROWS_PER_CHUNK = 64;

// 🖼️ アバター画像をグレースケール化した Canvas を返す
async function grayscaleAvatarCanvas(
  avatar: Image | Canvas,
  exact = false,
): Promise<Canvas> {
  const w = AVATAR_WIDTH;
  const h = IMAGE_HEIGHT;
  const off = createCanvas(w, h);
  const ctx = off.getContext("2d");
  if (exact) {
    // 🎯 本家実測: アバターは高さ 630 にフィットした正方形（630x630）を
    // x=-26 に置く（cover 640 配置より約 28px 左・約 1% 小さい）
    const scale = h / avatar.height;
    const dw = avatar.width * scale;
    ctx.drawImage(avatar, -26 + (630 - dw) / 2, 0, dw, h);
  } else {
    const scale = Math.max(w / avatar.width, h / avatar.height);
    const dw = avatar.width * scale;
    const dh = avatar.height * scale;
    ctx.drawImage(avatar, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let y = 0; y < h; y++) {
    const rowStart = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = rowStart + x * 4;
      // 🎯 exact は本家（Rust image crate の to_luma）に合わせ BT.709
      // 係数・コントラストなし。standard は従来どおり BT.601 + 軽い
      // コントラスト（実測比較で分離した）
      let g = exact
        ? 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
        : 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (!exact) {
        // わずかにコントラストを上げる
        g = Math.max(0, Math.min(255, (g - 128) * 1.06 + 128));
      }
      px[i] = g;
      px[i + 1] = g;
      px[i + 2] = g;
    }
    if ((y + 1) % GRAYSCALE_ROWS_PER_CHUNK === 0 && y + 1 < h) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  ctx.putImageData(data, 0, 0);
  return off;
}

// ------------------------------------------
// 😀 絵文字混じりテキストの描画
// ------------------------------------------
type DrawContext = ReturnType<Canvas["getContext"]>;

// ✏️ 解決済みトークン列を（x, baselineY）から左寄せで1行分描く。
// 画像はフォントサイズ相当の正方形として、ベースラインの少し下に
// はみ出す位置（通常の絵文字表示と同じ比率）に配置する。
function drawRichTokens(
  ctx: DrawContext,
  tokens: ResolvedToken[],
  x: number,
  baselineY: number,
  fontSize: number,
  measure: MeasureFn,
): void {
  let cursor = x;
  for (const token of tokens) {
    if (token.kind === "text") {
      if (token.text !== "") {
        ctx.fillText(token.text, cursor, baselineY);
        cursor += measure(token.text);
      }
    } else {
      ctx.drawImage(
        token.image,
        cursor,
        baselineY - fontSize * 0.86,
        fontSize,
        fontSize,
      );
      cursor += fontSize;
    }
  }
}

// ------------------------------------------
// 🎨 描画本体
// ------------------------------------------
// 🎨 名言画像（PNG）を描画する
export async function renderQuoteImage(
  input: QuoteImageInput,
): Promise<Buffer> {
  ensureFonts();
  // 🎯 バリアント別のレイアウト値（本家実測に基づく）
  const exact = input.variant === "exact";
  const centerX = exact ? 855 : 862; // 本文ブロックの中心（exact: 本家実測 855）
  const GAP = exact ? 30 : 22; // 引用文と発言者ブロックの間隔
  const NAME_SLANT = exact ? 0.25 : 0.2; // 名前の擬似イタリックの傾き
  // 🎨 色（exact は本家実測: 本文・名前は純白、@名とクレジットは #a2a2a2）
  const colText = exact ? "#ffffff" : TEXT;
  const colName = exact ? "#ffffff" : NAME_TEXT;
  const colSub = exact ? "#a2a2a2" : SUB_TEXT;
  const colCredit = exact ? "#a2a2a2" : CREDIT;
  // 🎯 微調整（本家2サンプルで一致）: exact では引用文のベースラインを
  // +1px、名前を +2px 下げる（フォント描画系の違いによる系統的なずれ）
  const QUOTE_DY = exact ? 1 : 0;
  const NAME_DY = exact ? 2 : 0;
  const canvas = createCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
  const ctx = canvas.getContext("2d");

  // ⬛ 背景
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

  // 👤 アバター（グレースケール）と、右へ向けて黒に消えるフェード。
  // フェードはアバター領域の右端（640）より手前で完了させ、写真の
  // 切り目が見えないようにする。
  ctx.drawImage(await grayscaleAvatarCanvas(input.avatar, exact), 0, 0);
  if (exact) {
    // 🎯 本家実測: フェードは縦一様ではなく「黒い霧」のような斜め
    // グラデーション。座標 u = x + 0.25 * (630 - y) に対して
    // smoothstep（u: 290→590）で濃くなる。上ほど早く暗くなり、
    // 右上から霧がかかる形になる（y バンド別の alpha 実測で特定）
    const fog = createCanvas(AVATAR_WIDTH, IMAGE_HEIGHT);
    const fogCtx = fog.getContext("2d");
    const img = fogCtx.createImageData(AVATAR_WIDTH, IMAGE_HEIGHT);
    const d = img.data;
    for (let y = 0; y < IMAGE_HEIGHT; y++) {
      const uBase = 0.25 * (IMAGE_HEIGHT - y) - 290;
      for (let x = 0; x < AVATAR_WIDTH; x++) {
        const t = Math.min(1, Math.max(0, (x + uBase) / 300));
        const a = t * t * (3 - 2 * t);
        const i = (y * AVATAR_WIDTH + x) * 4;
        d[i + 3] = Math.round(a * 255); // RGB は 0（黒）のまま
      }
    }
    fogCtx.putImageData(img, 0, 0);
    ctx.drawImage(fog, 0, 0);
  } else {
    const fade = ctx.createLinearGradient(280, 0, 620, 0);
    fade.addColorStop(0, "rgba(0,0,0,0)");
    fade.addColorStop(1, BG);
    ctx.fillStyle = fade;
    ctx.fillRect(280, 0, IMAGE_WIDTH - 280, IMAGE_HEIGHT);
  }

  // 💬 引用文（M PLUS Rounded 1c・中央寄せ・サイズ自動調整）
  const measureAt = (size: number): MeasureFn => {
    ctx.font = `${size}px "${MAIN}"`;
    return (s: string) => ctx.measureText(s).width;
  };
  const fitOptions = {
    maxWidth: TEXT_WIDTH,
    maxHeight: QUOTE_MAX_HEIGHT,
    sizes: exact ? [60, 56, 50, 44, 38, 32, 27] : [62, 56, 50, 44, 38, 32, 27],
    lineHeightRatio: 1.42,
    measureAt,
  };

  // 👤 発言者ブロックのサイズ
  const NAME_SIZE = 29;
  const USER_SIZE = exact ? 20 : 22;

  // 😀 絵文字が本文・表示名のどちらにも無ければ従来経路で描く（結果は
  // 従来と同一）。絵文字がある場合は、絵文字画像を行内に配置する経路で
  // 描く。
  const textTokens = tokenizeRichText(input.text);
  const nameTokens = tokenizeRichText(input.displayName);
  if (!hasEmojiToken(textTokens) && !hasEmojiToken(nameTokens)) {
    const fit = fitQuoteText(input.text, fitOptions);

    // 📐 引用文 + 発言者ブロック全体を縦中央に配置する
    const quoteBlock = fit.lines.length * fit.lineHeight;
    const totalHeight = quoteBlock + GAP + NAME_SIZE + 12 + USER_SIZE;
    const top = (IMAGE_HEIGHT - totalHeight) / 2;

    ctx.font = `${fit.fontSize}px "${MAIN}"`;
    ctx.fillStyle = colText;
    ctx.textAlign = "center";
    fit.lines.forEach((line, i) => {
      const y = top + fit.lineHeight * (i + 1.0);
      ctx.fillText(line, centerX, y + QUOTE_DY);
    });

    // 👤 発言者: 「- 表示名」（わずかに斜体）と「@ユーザー名」
    const nameY = top + quoteBlock + GAP + NAME_SIZE * 0.82 + NAME_DY;
    ctx.font = `${NAME_SIZE}px "${MAIN}"`;
    ctx.fillStyle = colName;
    ctx.save();
    // 擬似イタリック（本家の傾きに合わせる）
    ctx.transform(1, 0, -NAME_SLANT, 1, NAME_SLANT * nameY, 0);
    ctx.fillText(`- ${input.displayName}`, centerX, nameY);
    ctx.restore();

    // 名前だけ下げて @名の位置は本家に合わせ据え置く
    const userY = nameY - NAME_DY + 12 + USER_SIZE;
    ctx.font = `${USER_SIZE}px "${MAIN}"`;
    ctx.fillStyle = colSub;
    if (exact) {
      ctx.fillText(`@${input.username}`, centerX, userY);
    } else {
      ctx.save();
      // standard は @名も傾ける
      ctx.transform(1, 0, -0.2, 1, 0.2 * userY, 0);
      ctx.fillText(`@${input.username}`, centerX, userY);
      ctx.restore();
    }
    ctx.textAlign = "left";
  } else {
    const loader = input.emojiImageLoader ?? fetchEmojiImage;
    const resolvedText = await resolveRichTokens(textTokens, loader);
    const resolvedName = await resolveRichTokens(nameTokens, loader);
    const fit = fitRichText(resolvedText, fitOptions);

    const quoteBlock = fit.lines.length * fit.lineHeight;
    const totalHeight = quoteBlock + GAP + NAME_SIZE + 12 + USER_SIZE;
    const top = (IMAGE_HEIGHT - totalHeight) / 2;

    // 💬 引用文: 行ごとにトークン単位で描く（全体は中央寄せ）
    ctx.font = `${fit.fontSize}px "${MAIN}"`;
    ctx.fillStyle = colText;
    ctx.textAlign = "left";
    const quoteMeasure = measureAt(fit.fontSize);
    fit.lines.forEach((line, i) => {
      const y = top + fit.lineHeight * (i + 1.0);
      const lineWidth = measureRichLine(line, quoteMeasure, fit.fontSize);
      drawRichTokens(
        ctx,
        line,
        centerX - lineWidth / 2,
        y + QUOTE_DY,
        fit.fontSize,
        quoteMeasure,
      );
    });

    // 👤 発言者: 「- 表示名」（わずかに斜体）。絵文字は名前サイズの
    // 正方形で配置する
    const nameY = top + quoteBlock + GAP + NAME_SIZE * 0.82 + NAME_DY;
    ctx.font = `${NAME_SIZE}px "${MAIN}"`;
    ctx.fillStyle = colName;
    const nameMeasure = measureAt(NAME_SIZE);
    const prefix = "- ";
    const nameWidth =
      nameMeasure(prefix) +
      measureRichLine(resolvedName, nameMeasure, NAME_SIZE);
    ctx.save();
    // 擬似イタリック（本家の傾きに合わせる）
    ctx.transform(1, 0, -NAME_SLANT, 1, NAME_SLANT * nameY, 0);
    let nameX = centerX - nameWidth / 2;
    ctx.fillText(prefix, nameX, nameY);
    nameX += nameMeasure(prefix);
    drawRichTokens(ctx, resolvedName, nameX, nameY, NAME_SIZE, nameMeasure);
    ctx.restore();

    // 名前だけ下げて @名の位置は本家に合わせ据え置く
    const userY = nameY - NAME_DY + 12 + USER_SIZE;
    ctx.font = `${USER_SIZE}px "${MAIN}"`;
    ctx.fillStyle = colSub;
    ctx.textAlign = "center";
    if (exact) {
      ctx.fillText(`@${input.username}`, centerX, userY);
    } else {
      ctx.save();
      // standard は @名も傾ける
      ctx.transform(1, 0, -0.2, 1, 0.2 * userY, 0);
      ctx.fillText(`@${input.username}`, centerX, userY);
      ctx.restore();
    }
    ctx.textAlign = "left";
  }

  // ✒️ クレジット（右下）
  ctx.fillStyle = colCredit;
  if (exact) {
    // 本家と完全同一（文字列・サイズ・位置とも実測に合わせる）
    ctx.font = `21px "${SANS}"`;
    const credit = "Make it a Quote#6660";
    ctx.fillText(
      credit,
      IMAGE_WIDTH - 9 - ctx.measureText(credit).width,
      IMAGE_HEIGHT - 15,
    );
  } else {
    // standard は Bot 自身のタグで、本家の生成物と見分けがつくようにする
    ctx.font = `17px "${SANS}"`;
    const credit = input.credit ?? "Make It a Quote#3382";
    ctx.fillText(
      credit,
      IMAGE_WIDTH - 30 - ctx.measureText(credit).width,
      IMAGE_HEIGHT - 22,
    );
  }

  return canvas.encode("png");
}

// ------------------------------------------
// 👤 アバター取得失敗時の代替画像
// ------------------------------------------
// 👤 名前のハッシュで決まる色のグラデーション + 頭文字。
export function fallbackAvatar(displayName: string): Canvas {
  ensureFonts();
  const size = 630;
  const c = createCanvas(size, size);
  const ctx = c.getContext("2d");
  let hash = 0;
  for (const ch of displayName) hash = (hash * 31 + ch.codePointAt(0)!) % 360;
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, `hsl(${hash}, 32%, 30%)`);
  grad.addColorStop(1, `hsl(${(hash + 40) % 360}, 36%, 16%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const initial = [...displayName][0] ?? "?";
  ctx.fillStyle = "rgba(245,243,236,0.92)";
  ctx.font = `300px "${SANS}"`;
  const w = ctx.measureText(initial).width;
  ctx.fillText(initial, (size - w) / 2, size / 2 + 108);
  return c;
}
