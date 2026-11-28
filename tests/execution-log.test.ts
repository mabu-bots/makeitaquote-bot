// ===== テスト: コマンド実行ログの整形 =====
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatExecutionLog, summarizeError } from "../src/execution-log.js";

const NOW = new Date("2026-11-22T15:07:44.123Z");

test("成功時はメタ情報のみの1行になる (本文は含まない)", () => {
  const line = formatExecutionLog(
    {
      cmd: "quote",
      route: "slash",
      guildId: "111",
      channelId: "222",
      userId: "333",
      chars: 42,
      ok: true,
    },
    NOW,
  );
  assert.equal(
    line,
    "[exec] 2026-11-22T15:07:44.123Z cmd=quote route=slash guild=111 channel=222 user=333 chars=42 result=ok",
  );
});

test("コンテキスト経路と DM (guild なし) の表記", () => {
  const line = formatExecutionLog(
    {
      cmd: "quote",
      route: "context",
      guildId: null,
      channelId: null,
      userId: "333",
      chars: 0,
      ok: true,
    },
    NOW,
  );
  assert.equal(
    line,
    "[exec] 2026-11-22T15:07:44.123Z cmd=quote route=context guild=- channel=- user=333 chars=0 result=ok",
  );
});

test("失敗時はエラーの要点が付く", () => {
  const line = formatExecutionLog(
    {
      cmd: "quote",
      route: "slash",
      guildId: "111",
      channelId: "222",
      userId: "333",
      chars: 5,
      ok: false,
      error: new Error("boom"),
    },
    NOW,
  );
  assert.ok(line.endsWith('result=error error="Error: boom"'));
});

test("summarizeError: 改行と引用符を潰して1行化する", () => {
  assert.equal(summarizeError(new Error('a\nb "c"')), "Error: a b 'c'");
  assert.equal(summarizeError("文字列エラー"), "文字列エラー");
});

test("summarizeError: 長すぎるエラーは切り詰める", () => {
  const summary = summarizeError(new Error("x".repeat(200)));
  assert.equal(summary.length, 101);
  assert.ok(summary.endsWith("…"));
});
