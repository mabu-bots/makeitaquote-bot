// ===== テスト: レンダラ =====
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import {
  IMAGE_HEIGHT,
  IMAGE_WIDTH,
  fallbackAvatar,
  renderQuoteImage,
} from "../src/quote/renderer.js";

function solidAvatar() {
  const c = createCanvas(400, 400);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#c0392b"; // 赤（グレースケール化の確認用に色付き）
  ctx.fillRect(0, 0, 400, 400);
  return c;
}

test("PNG が生成され、サイズが 1200x630 である", async () => {
  const png = await renderQuoteImage({
    text: "テストの名言です",
    displayName: "テスト太郎",
    username: "test_taro",
    avatar: solidAvatar(),
  });
  // PNG シグネチャ
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  // IHDR の幅・高さ（ビッグエンディアン）
  assert.equal(png.readUInt32BE(16), IMAGE_WIDTH);
  assert.equal(png.readUInt32BE(20), IMAGE_HEIGHT);
  assert.ok(png.length > 10_000, "画像が極端に小さくないこと");
});

test("長いテキストでも生成できる (自動縮小と切り捨て)", async () => {
  const png = await renderQuoteImage({
    text: "長い文章のテストです。".repeat(30),
    displayName: "長文の人",
    username: "long_text",
    avatar: solidAvatar(),
  });
  assert.equal(png.readUInt32BE(16), IMAGE_WIDTH);
});

test("fallbackAvatar は 630x630 の Canvas を返す", () => {
  const c = fallbackAvatar("まぶ");
  assert.equal(c.width, 630);
  assert.equal(c.height, 630);
});

test("バリアント: exact と standard で異なる画像になる (高精度版の分離)", async () => {
  const base = {
    text: "バリアント確認の名言です",
    displayName: "テスト太郎",
    username: "test_taro",
    avatar: solidAvatar(),
  };
  const exact = await renderQuoteImage({ ...base, variant: "exact" });
  const standard = await renderQuoteImage({ ...base, variant: "standard" });
  assert.notDeepEqual(exact, standard);
  // 未指定時は standard（高精度版は明示した経路だけ）
  const fallback = await renderQuoteImage({ ...base });
  assert.deepEqual(fallback, standard);
});
