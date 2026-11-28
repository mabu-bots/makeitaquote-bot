// ===== テスト: 生成画像アーカイブ（保存・保持ルール） =====
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  archiveEnabled,
  buildArchiveFileName,
  saveQuoteArchive,
  selectPruneTargets,
  type QuoteArchiveEntry,
} from "../src/quote-archive.js";

const ENTRY: QuoteArchiveEntry = {
  route: "slash",
  guildId: "111111111111111111",
  channelId: "222222222222222222",
  messageId: "333333333333333333",
  requesterId: "444444444444444444",
  quotedUserId: "555555555555555555",
  text: "テストの名言",
};

test("ファイル名は時刻順に並び、作成者と引用された人のIDを含む", () => {
  const name = buildArchiveFileName(
    new Date("2026-11-24T12:25:30.000Z"),
    ENTRY.requesterId,
    ENTRY.quotedUserId,
  );
  assert.equal(
    name,
    `20261124-122530Z_${ENTRY.requesterId}_${ENTRY.quotedUserId}.png`,
  );
});

test("QUOTE_ARCHIVE=off/false/0 で無効、それ以外と未設定は有効", () => {
  assert.equal(archiveEnabled({}), true);
  assert.equal(archiveEnabled({ QUOTE_ARCHIVE: "off" }), false);
  assert.equal(archiveEnabled({ QUOTE_ARCHIVE: "OFF" }), false);
  assert.equal(archiveEnabled({ QUOTE_ARCHIVE: "false" }), false);
  assert.equal(archiveEnabled({ QUOTE_ARCHIVE: "0" }), false);
  assert.equal(archiveEnabled({ QUOTE_ARCHIVE: "on" }), true);
});

test("保存すると PNG と index.jsonl の1行が残る", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quote-archive-"));
  const png = Buffer.from("fake-png-bytes");
  const fileName = await saveQuoteArchive(
    dir,
    ENTRY,
    png,
    new Date("2026-11-24T12:25:30.000Z"),
  );
  assert.deepEqual(await readFile(join(dir, fileName)), png);
  const lines = (await readFile(join(dir, "index.jsonl"), "utf8"))
    .trim()
    .split("\n");
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.file, fileName);
  assert.equal(record.requesterId, ENTRY.requesterId);
  assert.equal(record.quotedUserId, ENTRY.quotedUserId);
  assert.equal(record.text, ENTRY.text);
  assert.equal(record.route, "slash");
});

test("保持期間 (30日) を超えた画像は選定される", () => {
  const now = Date.parse("2026-11-24T00:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const targets = selectPruneTargets(
    [
      { name: "old.png", mtimeMs: now - 31 * day },
      { name: "fresh.png", mtimeMs: now - 1 * day },
      { name: "index.jsonl", mtimeMs: now - 100 * day },
    ],
    now,
  );
  assert.deepEqual(targets, ["old.png"]);
});

test("上限件数を超えたら古い順に消す", () => {
  const now = Date.parse("2026-11-24T00:00:00Z");
  const files = [0, 1, 2, 3].map((i) => ({
    name: `f${i}.png`,
    mtimeMs: now - (10 - i) * 1000,
  }));
  const targets = selectPruneTargets(files, now, 2, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(targets, ["f0.png", "f1.png"]);
});

test("実際に古いファイルがある状態で保存すると掃除される", async () => {
  const dir = await mkdtemp(join(tmpdir(), "quote-archive-"));
  const oldPath = join(dir, "20000101-000000Z_1_2.png");
  await writeFile(oldPath, "old");
  const old = new Date("2000-01-01T00:00:00Z");
  await utimes(oldPath, old, old);
  await saveQuoteArchive(dir, ENTRY, Buffer.from("new"), new Date());
  const names = await readdir(dir);
  assert.ok(!names.includes("20000101-000000Z_1_2.png"), "古い画像は消える");
  assert.ok(
    names.some((n) => n.endsWith(".png") && n !== "20000101-000000Z_1_2.png"),
  );
  assert.ok(names.includes("index.jsonl"), "index.jsonl は残る");
});
