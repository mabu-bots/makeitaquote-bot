// ===== テスト: 名言画像の削除ボタン（権限判定・customId） =====
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildQuoteDeleteCustomId,
  buildQuoteDeleteRow,
  canDeleteQuote,
  parseQuoteDeleteCustomId,
} from "../src/quote-delete.js";

const QUOTED = "111111111111111111";
const REQUESTER = "222222222222222222";
const OTHER = "333333333333333333";

test("customId は往復変換できる", () => {
  const customId = buildQuoteDeleteCustomId(QUOTED, REQUESTER);
  assert.deepEqual(parseQuoteDeleteCustomId(customId), {
    quotedUserId: QUOTED,
    requesterId: REQUESTER,
  });
});

test("customId が不正な形式なら null (他のボタンを誤処理しない)", () => {
  assert.equal(parseQuoteDeleteCustomId("some-other-button"), null);
  assert.equal(parseQuoteDeleteCustomId("quote-delete:abc:def"), null);
  assert.equal(parseQuoteDeleteCustomId(`quote-delete:${QUOTED}`), null);
  assert.equal(
    parseQuoteDeleteCustomId(`quote-delete:${QUOTED}:${REQUESTER}:extra`),
    null,
  );
  assert.equal(parseQuoteDeleteCustomId(""), null);
});

test("削除できるのは引用された本人と作成者だけ", () => {
  const ids = { quotedUserId: QUOTED, requesterId: REQUESTER };
  assert.equal(canDeleteQuote(QUOTED, ids), true, "引用された本人は消せる");
  assert.equal(canDeleteQuote(REQUESTER, ids), true, "作成者は消せる");
  assert.equal(canDeleteQuote(OTHER, ids), false, "第三者は消せない");
});

test("引用された本人＝作成者 (自分の発言を自分で引用) でも消せる", () => {
  const ids = { quotedUserId: QUOTED, requesterId: QUOTED };
  assert.equal(canDeleteQuote(QUOTED, ids), true);
  assert.equal(canDeleteQuote(OTHER, ids), false);
});

test("削除ボタン行に customId とラベルが入る", () => {
  const row = buildQuoteDeleteRow(QUOTED, REQUESTER).toJSON();
  assert.equal(row.components.length, 1);
  const button = row.components[0] as { custom_id?: string; label?: string };
  assert.equal(button.custom_id, buildQuoteDeleteCustomId(QUOTED, REQUESTER));
  assert.equal(button.label, "削除する");
});
