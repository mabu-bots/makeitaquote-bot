// ==========================================
// 🗑️ 12. 名言画像の削除ボタン
// ==========================================
// 🗑️ 生成した名言画像には削除ボタンを付ける。押せるのは
// - 引用された本人（ユーザーIDを使用された人: /quote の user、
//   右クリック経路では元の発言者）
// - 画像を作成した人（コマンドを実行した人）
// の2人だけ。それ以外の人が押した場合は削除せず、その旨を ephemeral
// で返す。ボタンの customId に両者の ID を埋め込むので、Bot を再起動
// しても（＝ボタンの状態をメモリに持たなくても）判定できる。
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

// 🏷️ customId の形式: quote-delete:<引用された人のID>:<作成者のID>
export const QUOTE_DELETE_CUSTOM_ID_PREFIX = "quote-delete";

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

// 🗑️ 削除ボタンに埋め込む2人の ID
export interface QuoteDeleteIds {
  quotedUserId: string;
  requesterId: string;
}

// 🏷️ 削除ボタン用の customId を組み立てる
export function buildQuoteDeleteCustomId(
  quotedUserId: string,
  requesterId: string,
): string {
  return `${QUOTE_DELETE_CUSTOM_ID_PREFIX}:${quotedUserId}:${requesterId}`;
}

// 🔍 customId から引用された人と作成者の ID を取り出す
export function parseQuoteDeleteCustomId(
  customId: string,
): QuoteDeleteIds | null {
  const parts = customId.split(":");
  if (parts.length !== 3 || parts[0] !== QUOTE_DELETE_CUSTOM_ID_PREFIX) {
    return null;
  }
  const [, quotedUserId, requesterId] = parts;
  if (
    !SNOWFLAKE_PATTERN.test(quotedUserId) ||
    !SNOWFLAKE_PATTERN.test(requesterId)
  ) {
    return null;
  }
  return { quotedUserId, requesterId };
}

// ✅ 削除できるのは、引用された本人と作成者だけ
export function canDeleteQuote(
  clickerId: string,
  ids: QuoteDeleteIds,
): boolean {
  return clickerId === ids.quotedUserId || clickerId === ids.requesterId;
}

// 🔘 削除ボタンの行（ActionRow）を作る
export function buildQuoteDeleteRow(
  quotedUserId: string,
  requesterId: string,
): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setCustomId(buildQuoteDeleteCustomId(quotedUserId, requesterId))
    .setLabel("削除する")
    .setEmoji("🗑️")
    .setStyle(ButtonStyle.Danger);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}
