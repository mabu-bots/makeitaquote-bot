// ===== テスト: プレゼンス・サイクル =====
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRESENCE_SEND_LEAD_MS,
  formatElapsedMinutes,
  nextPresenceSend,
  presenceCycleText,
} from "../src/presence-cycle.js";

test("formatElapsedMinutes: 1時間未満は分だけ、以上は時間+分", () => {
  assert.equal(formatElapsedMinutes(0), "0分");
  assert.equal(formatElapsedMinutes(59_999), "0分");
  assert.equal(formatElapsedMinutes(60_000), "1分");
  assert.equal(formatElapsedMinutes(26 * 60_000), "26分");
  assert.equal(formatElapsedMinutes(86 * 60_000), "1時間26分");
  assert.equal(formatElapsedMinutes(120 * 60_000), "2時間00分");
  assert.equal(formatElapsedMinutes(-1), "0分");
});

test("presenceCycleText: Unix 分の偶奇で2パターンを切り替える", () => {
  const startedAt = Date.UTC(2026, 0, 1, 0, 0, 0);
  // 偶数分: 経過時間（開始直後なので 0分）
  const even = new Date(startedAt);
  assert.equal(
    presenceCycleText("quote", startedAt, even),
    "quote | 起動して 0分",
  );
  // 奇数分: 現在時刻（JST = UTC+9）
  const odd = new Date(startedAt + 60_000);
  assert.equal(
    presenceCycleText("quote", startedAt, odd),
    "quote | 現在時刻 09:01 JST",
  );
});

test("nextPresenceSend: 境界の 200ms 前に送信し、過ぎていたら翌分へ進める", () => {
  const now = Date.UTC(2026, 0, 1, 0, 0, 10, 0); // 分の途中
  const { sendAt, boundary } = nextPresenceSend(now);
  assert.equal(boundary, Date.UTC(2026, 0, 1, 0, 1, 0, 0));
  assert.equal(sendAt, boundary - PRESENCE_SEND_LEAD_MS);
  // 境界の 200ms 前を過ぎている場合は翌分の境界へ
  const late = nextPresenceSend(boundary - 100);
  assert.equal(late.boundary, boundary + 60_000);
  assert.equal(late.sendAt, boundary + 60_000 - PRESENCE_SEND_LEAD_MS);
});
