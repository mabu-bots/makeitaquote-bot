// ===== テスト: 利用制限（文字数上限・クールダウン・同時実行数） =====
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCommands } from "../src/commands.js";
import {
  CooldownTracker,
  MAX_QUOTE_TEXT_LENGTH,
  RenderSemaphore,
  exceedsQuoteTextLength,
  quoteTextLength,
} from "../src/guard.js";

test("文字数上限: ちょうど300文字は可、301文字は超過", () => {
  assert.equal(
    exceedsQuoteTextLength("あ".repeat(MAX_QUOTE_TEXT_LENGTH)),
    false,
  );
  assert.equal(
    exceedsQuoteTextLength("あ".repeat(MAX_QUOTE_TEXT_LENGTH + 1)),
    true,
  );
  assert.equal(exceedsQuoteTextLength(""), false);
});

test("文字数はコードポイント単位で数える (絵文字は1文字)", () => {
  assert.equal(quoteTextLength("😀".repeat(300)), 300);
  assert.equal(exceedsQuoteTextLength("😀".repeat(300)), false);
  assert.equal(exceedsQuoteTextLength("😀".repeat(301)), true);
});

test("/quote のコマンド定義の上限と MAX_QUOTE_TEXT_LENGTH が一致する", () => {
  const slash = buildCommands().find((c) => c.name === "quote");
  assert.ok(slash && "options" in slash);
  const textOption = slash.options?.find(
    (o) => "name" in o && o.name === "text",
  );
  assert.ok(textOption && "max_length" in textOption);
  assert.equal(textOption.max_length, MAX_QUOTE_TEXT_LENGTH);
});

test("クールダウン: 開始直後は残り時間を返し、経過後は再び開始できる", () => {
  const tracker = new CooldownTracker(1000);
  assert.equal(tracker.tryStart("user1", 10_000), 0);
  assert.equal(tracker.tryStart("user1", 10_400), 600);
  assert.equal(tracker.remainingMs("user1", 10_999), 1);
  assert.equal(tracker.tryStart("user1", 11_000), 0);
});

test("クールダウン: ユーザーごとに独立し、remainingMs は記録しない", () => {
  const tracker = new CooldownTracker(1000);
  assert.equal(tracker.remainingMs("user2", 0), 0);
  // remainingMs を見ただけではクールダウンが始まらないこと
  assert.equal(tracker.tryStart("user2", 0), 0);
  assert.equal(tracker.tryStart("user1", 0), 0);
  assert.equal(tracker.tryStart("user1", 500), 500);
  assert.equal(tracker.remainingMs("user2", 500), 500);
});

test("セマフォ: 上限まで取得でき、解放すると再び取得できる", () => {
  const sem = new RenderSemaphore(2);
  assert.equal(sem.tryAcquire(), true);
  assert.equal(sem.tryAcquire(), true);
  assert.equal(sem.tryAcquire(), false);
  assert.equal(sem.activeCount, 2);
  sem.release();
  assert.equal(sem.activeCount, 1);
  assert.equal(sem.tryAcquire(), true);
});

test("セマフォ: 余分な release で件数が負にならない", () => {
  const sem = new RenderSemaphore(1);
  sem.release();
  assert.equal(sem.activeCount, 0);
  assert.equal(sem.tryAcquire(), true);
  sem.release();
  sem.release();
  assert.equal(sem.activeCount, 0);
});
