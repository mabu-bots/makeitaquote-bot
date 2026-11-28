// ===== テスト: 折り返し・サイズ調整 =====
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  codePointLength,
  dropLastCodePoint,
  fitQuoteText,
  lastCodePoint,
  wrapText,
  type MeasureFn,
} from "../src/quote/wrap.js";

// 1文字 = 10px として測る決定的なモック
const measure: MeasureFn = (s) => [...s].length * 10;
const measureAt =
  (size: number): MeasureFn =>
  (s) =>
    [...s].length * size;

test("収まるテキストは1行のまま", () => {
  assert.deepEqual(wrapText("あいうえお", 100, measure), ["あいうえお"]);
});

test("幅を超えたら折り返す", () => {
  assert.deepEqual(wrapText("あいうえおかきくけこ", 50, measure), [
    "あいうえお",
    "かきくけこ",
  ]);
});

test("改行は段落として尊重する", () => {
  assert.deepEqual(wrapText("あい\nうえお", 100, measure), ["あい", "うえお"]);
});

test("行頭禁則: 句読点は前の行に追い込む", () => {
  // 5文字で幅いっぱいのところに「、」が来たら、次行の行頭にはせず前に付ける
  const lines = wrapText("あいうえお、かき", 50, measure);
  assert.equal(lines[0], "あいうえお、");
  assert.equal(lines[1], "かき");
});

test("行末禁則: 開き括弧は次行へ送る", () => {
  const lines = wrapText("あいうえ「おかき", 50, measure);
  assert.equal(lines[0], "あいうえ");
  assert.equal(lines[1], "「おかき");
});

test("空文字は空の1行になる", () => {
  assert.deepEqual(wrapText("", 100, measure), [""]);
});

test("fitQuoteText: 短い文は最大サイズ、長い文は小さいサイズになる", () => {
  const opts = {
    maxWidth: 200,
    maxHeight: 200,
    sizes: [40, 30, 20],
    lineHeightRatio: 1.5,
    measureAt,
  };
  const short = fitQuoteText("あい", opts);
  assert.equal(short.fontSize, 40);
  const long = fitQuoteText("あいうえおかきくけこさしすせそたちつてと", opts);
  assert.ok(long.fontSize < 40);
  assert.ok(long.lines.length * long.lineHeight <= 200);
});

test("コードポイントヘルパ: サロゲートペアを切断しない", () => {
  assert.equal(lastCodePoint("あい😀"), "😀");
  assert.equal(lastCodePoint(""), undefined);
  assert.equal(dropLastCodePoint("あい😀"), "あい");
  assert.equal(dropLastCodePoint("😀"), "");
  assert.equal(dropLastCodePoint(""), "");
  assert.equal(codePointLength("あい😀"), 3);
});

test("行末禁則: 絵文字の後の開き括弧を次行へ送っても絵文字が壊れない", () => {
  const lines = wrapText("あいう😀「おかき", 50, measure);
  assert.deepEqual(lines, ["あいう😀", "「おかき"]);
});

test("fitQuoteText: 切り捨てで絵文字のサロゲートペアを分断しない", () => {
  // canvas の計測に近いコードユニット単位のモック（絵文字 = 2単位 = 20px）
  const unitMeasureAt =
    (_size: number): MeasureFn =>
    (s) =>
      s.length * 10;
  const result = fitQuoteText("ああ😀😀", {
    maxWidth: 40,
    maxHeight: 10,
    sizes: [10],
    lineHeightRatio: 1,
    measureAt: unitMeasureAt,
  });
  // 末尾の絵文字は丸ごと削られ、孤立サロゲートを残さない
  assert.deepEqual(result.lines, ["ああ…"]);
});

test("fitQuoteText: どうしても収まらない場合は切り捨てて … を付ける", () => {
  const result = fitQuoteText("あ".repeat(500), {
    maxWidth: 100,
    maxHeight: 60,
    sizes: [20],
    lineHeightRatio: 1.5,
    measureAt,
  });
  assert.ok(result.lines.length * result.lineHeight <= 60);
  assert.ok(result.lines[result.lines.length - 1].endsWith("…"));
});
