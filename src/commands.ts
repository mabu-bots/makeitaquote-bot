// ==========================================
// 💬 7. コマンド定義と登録
// ==========================================
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import { MAX_QUOTE_TEXT_LENGTH } from "./guard.js";

// 🖱️ メッセージの右クリック（アプリ）から実発言を名言画像にする
export const QUOTE_MESSAGE_COMMAND = "Make it a Quote";

// 💬 任意のユーザー×任意のテキストで名言画像を捏造する
export const QUOTE_SLASH_COMMAND = "quote";

// 🛠️ スラッシュコマンドとコンテキストメニューを組み立てる
export function buildCommands(): RESTPostAPIApplicationCommandsJSONBody[] {
  const context = new ContextMenuCommandBuilder()
    .setName(QUOTE_MESSAGE_COMMAND)
    .setType(ApplicationCommandType.Message);

  const slash = new SlashCommandBuilder()
    .setName(QUOTE_SLASH_COMMAND)
    .setDescription("指定したユーザーの発言として、名言風の画像を捏造します")
    .addUserOption((o) =>
      o
        .setName("user")
        .setDescription("発言者にするユーザー")
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("text")
        .setDescription(
          `発言したことにするテキスト (最大${MAX_QUOTE_TEXT_LENGTH}文字)`,
        )
        .setRequired(true)
        .setMaxLength(MAX_QUOTE_TEXT_LENGTH),
    );

  return [context.toJSON(), slash.toJSON()];
}

// 📡 コマンドを Discord に登録する。guildId があればギルド登録（即時）、
// 無ければグローバル登録（反映まで最大1時間）。
export async function registerCommands(
  token: string,
  clientId: string,
  guildId: string | null,
): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(token);
  const body = buildCommands();
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body,
    });
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
  }
}
