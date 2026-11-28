// ==========================================
// 🚀 8. コマンド登録だけを行うスクリプト（npm run deploy）
// ==========================================
// 🤖 Bot 本体は起動時にも自動登録するので、通常は実行不要。
// 登録だけ先に済ませたい場合に使う。
import { loadConfig } from "./config.js";
import { registerCommands } from "./commands.js";

const config = loadConfig();
await registerCommands(config.token, config.clientId, config.guildId);
console.log(
  config.guildId
    ? `コマンドをギルド ${config.guildId} に登録しました。`
    : "コマンドをグローバルに登録しました (反映まで最大1時間かかります)。",
);
