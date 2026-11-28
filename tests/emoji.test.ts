// ===== テスト: 絵文字トークン化・解決・折り返し =====
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import {
  customEmojiUrl,
  hasEmojiToken,
  isAllowedEmojiUrl,
  resolveRichTokens,
  tokenizeRichText,
  twemojiAssetCandidates,
  twemojiUrl,
  type EmojiImageLoader,
  type ResolvedToken,
} from "../src/quote/emoji.js";
import { renderQuoteImage } from "../src/quote/renderer.js";
import {
  fitRichText,
  measureRichLine,
  wrapRichText,
  type MeasureFn,
} from "../src/quote/wrap.js";

// 1文字 = 10px として測る決定的なモック（wrap.test.ts と同じ）
const measure: MeasureFn = (s) => [...s].length * 10;
const measureAt =
  (size: number): MeasureFn =>
  (s) =>
    [...s].length * size;

function dummyImage() {
  const c = createCanvas(72, 72);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffcc00";
  ctx.fillRect(0, 0, 72, 72);
  return c;
}

const okLoader: EmojiImageLoader = async () => dummyImage();
const failLoader: EmojiImageLoader = async () => null;

// ----- トークン化 -----
test("絵文字なしのテキストは text トークン1つ", () => {
  const tokens = tokenizeRichText("ただの文章です");
  assert.deepEqual(tokens, [{ kind: "text", text: "ただの文章です" }]);
  assert.equal(hasEmojiToken(tokens), false);
});

test("単体絵文字を分離する", () => {
  const tokens = tokenizeRichText("今日は😀です");
  assert.equal(tokens.length, 3);
  assert.deepEqual(tokens[0], { kind: "text", text: "今日は" });
  assert.equal(tokens[1].kind, "emoji");
  assert.deepEqual(tokens[2], { kind: "text", text: "です" });
  assert.equal(hasEmojiToken(tokens), true);
});

test("ZWJ 結合シーケンスは1トークンになる", () => {
  const tokens = tokenizeRichText("家族👨‍👩‍👧です");
  const emoji = tokens.filter((t) => t.kind === "emoji");
  assert.equal(emoji.length, 1);
  assert.equal(emoji[0].kind === "emoji" && emoji[0].raw, "👨‍👩‍👧");
});

test("肌色修飾は基底と一体で1トークンになる", () => {
  const tokens = tokenizeRichText("💪🏽");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].kind, "emoji");
});

test("国旗 (Regional Indicator ペア) は1トークンになる", () => {
  const tokens = tokenizeRichText("🇯🇵");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].kind, "emoji");
});

test("キートップは1トークン、ただの数字はテキストのまま", () => {
  const keycap = tokenizeRichText("1️⃣");
  assert.equal(keycap.length, 1);
  assert.equal(keycap[0].kind, "emoji");
  const plain = tokenizeRichText("2026年");
  assert.equal(hasEmojiToken(plain), false);
});

test("VS16 付きハートは1トークンになる", () => {
  const tokens = tokenizeRichText("❤️");
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].kind, "emoji");
});

test("Discord カスタム絵文字 (静止画・アニメ) を分離する", () => {
  const tokens = tokenizeRichText(
    "やった<:party_blob:1234567890123456789>ね<a:win:9876543210987654321>！",
  );
  const customs = tokens.filter((t) => t.kind === "custom");
  assert.equal(customs.length, 2);
  assert.deepEqual(
    customs.map((t) => (t.kind === "custom" ? [t.id, t.animated] : null)),
    [
      ["1234567890123456789", false],
      ["9876543210987654321", true],
    ],
  );
});

// ----- Twemoji アセット名 -----
test("Twemoji アセット名: ZWJ なしでは FE0F を落とす", () => {
  assert.equal(twemojiAssetCandidates("❤️")[0], "2764");
  assert.equal(twemojiAssetCandidates("1️⃣")[0], "31-20e3");
  assert.equal(twemojiAssetCandidates("💪🏽")[0], "1f4aa-1f3fd");
  assert.equal(twemojiAssetCandidates("🇯🇵")[0], "1f1ef-1f1f5");
  // 第2候補は FE0F の有無を反転した予備（取得失敗時に試す）
  assert.equal(twemojiAssetCandidates("❤️")[1], "2764-fe0f");
});

test("Twemoji アセット名: ZWJ ありでは FE0F を残す", () => {
  assert.equal(twemojiAssetCandidates("🏳️‍🌈")[0], "1f3f3-fe0f-200d-1f308");
  assert.equal(twemojiAssetCandidates("👨‍👩‍👧")[0], "1f468-200d-1f469-200d-1f467");
});

test("URL 生成と許可ホスト判定", () => {
  assert.equal(
    twemojiUrl("1f600"),
    "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f600.png",
  );
  assert.equal(
    customEmojiUrl("123"),
    "https://cdn.discordapp.com/emojis/123.png?size=96",
  );
  assert.equal(isAllowedEmojiUrl(twemojiUrl("1f600")), true);
  assert.equal(isAllowedEmojiUrl(customEmojiUrl("123")), true);
  assert.equal(isAllowedEmojiUrl("https://example.com/evil.png"), false);
  assert.equal(
    isAllowedEmojiUrl("http://cdn.discordapp.com/emojis/1.png"),
    false,
  );
});

// ----- 解決 -----
test("解決: 取得できれば画像トークン、失敗すればテキストに戻る", async () => {
  const tokens = tokenizeRichText("a😀b");
  const ok = await resolveRichTokens(tokens, okLoader);
  assert.equal(ok[1].kind, "image");
  const ng = await resolveRichTokens(tokens, failLoader);
  assert.deepEqual(ng[1], { kind: "text", text: "😀" });
});

test("解決: カスタム絵文字は Discord CDN の URL で取得する", async () => {
  const seen: string[] = [];
  const loader: EmojiImageLoader = async (url) => {
    seen.push(url);
    return dummyImage();
  };
  const tokens = tokenizeRichText("<:blob:111222333444555666>");
  const resolved = await resolveRichTokens(tokens, loader);
  assert.deepEqual(seen, [
    "https://cdn.discordapp.com/emojis/111222333444555666.png?size=96",
  ]);
  assert.equal(resolved[0].kind, "image");
});

// ----- 折り返し・計測 -----
function resolvedOf(text: string): Promise<ResolvedToken[]> {
  return resolveRichTokens(tokenizeRichText(text), okLoader);
}

test("折り返し: 絵文字は分割されず、幅は正方形として数える", async () => {
  const tokens = await resolvedOf("あいうえお😀かきくけこ");
  // 文字10px・絵文字50px、上限100px: 「あいうえお」(50) + 😀(50) で1行目いっぱい
  const lines = wrapRichText(tokens, 100, measure, 50);
  assert.equal(lines.length, 2);
  assert.equal(
    lines[0].some((t) => t.kind === "image"),
    true,
  );
  assert.equal(measureRichLine(lines[0], measure, 50), 100);
  assert.equal(measureRichLine(lines[1], measure, 50), 50);
});

test("折り返し: 行頭禁則は絵文字の直後でも効く", async () => {
  const tokens = await resolvedOf("あい😀、う");
  // 幅: あ(10) い(10) 😀(50) で70。「、」は行頭禁則なので前の行に追い込む
  const lines = wrapRichText(tokens, 70, measure, 50);
  assert.equal(lines.length, 2);
  const firstText = lines[0]
    .map((t) => (t.kind === "text" ? t.text : ""))
    .join("");
  assert.ok(firstText.endsWith("、"));
});

test("fitRichText: 収まるサイズと行を返す", async () => {
  const tokens = await resolvedOf("今日は最高😀🎉");
  const fit = fitRichText(tokens, {
    maxWidth: 596,
    maxHeight: 372,
    sizes: [62, 56, 50],
    lineHeightRatio: 1.42,
    measureAt,
  });
  assert.equal(fit.fontSize, 62);
  assert.equal(fit.lines.length, 1);
});

// ----- 描画スモーク -----
function solidAvatar() {
  const c = createCanvas(400, 400);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#c0392b";
  ctx.fillRect(0, 0, 400, 400);
  return c;
}

test("描画: 絵文字入りテキストと表示名で PNG が生成される", async () => {
  const png = await renderQuoteImage({
    text: "今日は最高😀🎉 家族👨‍👩‍👧で🇯🇵の1️⃣番❤️",
    displayName: "まぶ😀",
    username: "xx_mabu_xx",
    avatar: solidAvatar(),
    emojiImageLoader: okLoader,
  });
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test("描画: 絵文字画像が全て取得失敗でも PNG が生成される (テキスト代替)", async () => {
  const png = await renderQuoteImage({
    text: "失敗しても😀落ちない",
    displayName: "まぶ🎉",
    username: "xx_mabu_xx",
    avatar: solidAvatar(),
    emojiImageLoader: failLoader,
  });
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});
