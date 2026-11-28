// ==========================================
// 🤖 14. Bot 本体
// ==========================================
// 🤖 起動時にコマンドを自動登録し、2つの入口（メッセージの右クリック /
// /quote）から名言画像を生成して返す。特権 Intent は使わない。
import {
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type MessageContextMenuCommandInteraction,
  type User,
} from "discord.js";
import { loadConfig } from "./config.js";
import {
  QUOTE_MESSAGE_COMMAND,
  QUOTE_SLASH_COMMAND,
  registerCommands,
} from "./commands.js";
import {
  CooldownTracker,
  MAX_QUOTE_TEXT_LENGTH,
  RenderSemaphore,
  exceedsQuoteTextLength,
  quoteTextLength,
} from "./guard.js";
import { logExecution, type CommandRoute } from "./execution-log.js";
import { avatarOrFallback } from "./quote/avatar.js";
import { renderQuoteImage } from "./quote/renderer.js";
import {
  buildQuoteDeleteRow,
  canDeleteQuote,
  parseQuoteDeleteCustomId,
} from "./quote-delete.js";
import {
  archiveDir,
  archiveEnabled,
  saveQuoteArchive,
} from "./quote-archive.js";
import { attachReadyWatchdog } from "./watchdog.js";
import { startPresenceCycle } from "./presence-cycle.js";

const config = loadConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// 🐕 Gateway安全構造: READY が来ないサイレント停滞を検知して終了する（watchdog.ts）
attachReadyWatchdog(client);

// 🚨 Client の error 系イベントの受け皿（無いと未処理のまま握りつぶされる）
client.on(Events.Error, (error) => {
  console.error("Discord クライアントでエラーが発生しました:", error);
});
client.on(Events.ShardError, (error) => {
  console.error("Discord シャードでエラーが発生しました:", error);
});

// ------------------------------------------
// 🎯 高精度版（本家完全一致）のゲート
// ------------------------------------------
// 🎯 高精度版（本家完全一致）を使えるユーザー（悪用防止のため本人のみ）。
// /quote は誰の名前でも任意の文章を捏造できるため、本家と完全に見分けが
// つかない画像が出ると悪用時に本物と区別できない。実発言の右クリックは
// 元メッセージが実在するが、それでも操作できるのはこのユーザー本人が
// 右クリックしたときだけに限る（DESIGN.md の判断記録を参照）。
// ⚠️ この ID とゲート条件は安易に広げないこと。
const EXACT_ALLOWED_USER_ID = "1347457057078513695";

// 🛡️ 利用制限（guard.ts）: 連打と同時実行でリソースを使い切られないようにする
const cooldown = new CooldownTracker();
const renderSemaphore = new RenderSemaphore();

// 👤 表示名はグローバル表示名を使う（本家に合わせ、サーバーニックネームは
// 使わない）。本家は同じ発言でもニックネームではなくグローバル表示名で
// 描画するため、ニックネーム優先だと本家と名前が食い違う。
async function displayNameOf(
  interaction:
    ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
  user: User,
): Promise<string> {
  return user.displayName ?? user.username;
}

// 🛡️ 利用制限のチェック。開始できなければ理由を ephemeral で返して
// false を返す。開始できた場合はクールダウンを記録し、描画スロットを
// 確保した状態で true を返す。呼び出し側は処理後に必ず
// renderSemaphore.release() すること。
async function tryBeginQuote(
  interaction:
    ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
): Promise<boolean> {
  const remaining = cooldown.remainingMs(interaction.user.id);
  if (remaining > 0) {
    await interaction.reply({
      content: `連続して使えません。あと ${Math.ceil(remaining / 1000)} 秒お待ちください。`,
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  if (!renderSemaphore.tryAcquire()) {
    await interaction.reply({
      content:
        "ただいま混み合っています。少し時間をおいてもう一度お試しください。",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  // 🎫 混雑で弾かれた場合はクールダウンを消費しない（記録はスロット確保後に行う）
  cooldown.record(interaction.user.id);
  return true;
}

// 🖼️ 画像を生成して interaction に返す共通処理
async function replyWithQuote(
  interaction:
    ChatInputCommandInteraction | MessageContextMenuCommandInteraction,
  args: { text: string; user: User; route: "slash" | "context" },
): Promise<void> {
  const displayName = await displayNameOf(interaction, args.user);
  const avatar = await avatarOrFallback(
    args.user.displayAvatarURL({ extension: "png", size: 512 }),
    displayName,
  );
  const png = await renderQuoteImage({
    text: args.text,
    displayName,
    username: args.user.username,
    avatar,
    // 🎯 高精度版（本家完全一致）は、実発言の右クリック経路 かつ 許可
    // されたユーザー本人のときだけ使う。それ以外（/quote の捏造経路・
    // 他人の操作）は悪用防止として本家と見分けがつく従来版で生成する
    variant:
      args.route === "context" && interaction.user.id === EXACT_ALLOWED_USER_ID
        ? "exact"
        : "standard",
    credit: client.user?.tag,
  });
  const message = await interaction.editReply({
    files: [new AttachmentBuilder(png, { name: "quote.png" })],
    // 🗑️ 削除ボタン: 引用された本人（args.user）と作成者（interaction.user）だけが消せる
    components: [buildQuoteDeleteRow(args.user.id, interaction.user.id)],
  });
  // 🗄️ 不適切利用の確認用に、生成画像をサーバーへ保存する（quote-archive.ts）。
  // 保存に失敗しても生成自体は成功扱いのままにする。
  if (archiveEnabled()) {
    try {
      await saveQuoteArchive(
        archiveDir(),
        {
          route: args.route,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          messageId: message.id,
          requesterId: interaction.user.id,
          quotedUserId: args.user.id,
          text: args.text,
        },
        png,
      );
    } catch (e) {
      console.error("生成画像のアーカイブ保存に失敗しました:", e);
    }
  }
}

// ------------------------------------------
// 🗑️ 削除ボタン: 引用された本人と作成者だけが画像を消せる
// ------------------------------------------
// 🗑️ 削除ボタンの押下を処理する
async function handleQuoteDelete(
  interaction: ButtonInteraction,
): Promise<void> {
  const ids = parseQuoteDeleteCustomId(interaction.customId);
  if (!ids) return;
  if (!canDeleteQuote(interaction.user.id, ids)) {
    await interaction.reply({
      content: "この名言画像を消せるのは、引用された本人と作成者だけです。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  try {
    // 🗑️ ボタンの付いたメッセージ自体（Bot の投稿）を削除する
    await interaction.deferUpdate();
    await interaction.message.delete();
  } catch (e) {
    console.error("名言画像の削除に失敗しました:", e);
    try {
      await interaction.followUp({
        content:
          "削除に失敗しました。すでに消えているか、Bot にメッセージ削除の権限がありません。",
        flags: MessageFlags.Ephemeral,
      });
    } catch {
      // 📝 応答自体が失敗した場合はログのみ
    }
  }
}

// ------------------------------------------
// 🖱️ メッセージの右クリック: 実発言を名言画像にする
// ------------------------------------------
// 🖱️ メッセージの右クリックから名言画像を作る
async function handleQuoteMessage(
  interaction: MessageContextMenuCommandInteraction,
): Promise<void> {
  const message = interaction.targetMessage;
  const text = message.content.trim();
  if (!text) {
    await interaction.reply({
      content:
        "テキストのないメッセージ (画像・埋め込みのみ) からは名言画像を作れません。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // 🔢 /quote と同じ文字数上限をこの経路でも強制する。超過分を黙って
  // 切り捨てず、上限を超えていることを伝えて返る（README の「最大300文字」
  // と一致）。
  if (exceedsQuoteTextLength(text)) {
    await interaction.reply({
      content:
        `テキストが長すぎます (${quoteTextLength(text)}文字)。` +
        `名言画像にできるのは最大${MAX_QUOTE_TEXT_LENGTH}文字までです。短いメッセージでお試しください。`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!(await tryBeginQuote(interaction))) return;
  try {
    await interaction.deferReply();
    await replyWithQuote(interaction, {
      text,
      user: message.author,
      route: "context",
    });
  } finally {
    renderSemaphore.release();
  }
}

// ------------------------------------------
// 💬 /quote: 任意のテキストを捏造する
// ------------------------------------------
// 💬 /quote から任意のテキストの名言画像を作る
async function handleQuoteSlash(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const user = interaction.options.getUser("user", true);
  const text = interaction.options.getString("text", true).trim();
  if (!text) {
    await interaction.reply({
      content: "テキストが空です。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!(await tryBeginQuote(interaction))) return;
  try {
    await interaction.deferReply();
    await replyWithQuote(interaction, { text, user, route: "slash" });
  } finally {
    renderSemaphore.release();
  }
}

// ------------------------------------------
// 🚀 起動とイベント配線
// ------------------------------------------
client.once(Events.ClientReady, async (ready) => {
  // 👀 プレゼンスは全 Bot 共通のプレゼンス・サイクル（presence-cycle.ts）
  startPresenceCycle(client);
  try {
    await registerCommands(config.token, config.clientId, config.guildId);
    console.log(`ログイン完了: ${ready.user.tag} (コマンド登録済み)`);
  } catch (e) {
    console.error("コマンド登録に失敗しました:", e);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  // 🗑️ 削除ボタンはコマンドではないので、先に処理する
  if (
    interaction.isButton() &&
    parseQuoteDeleteCustomId(interaction.customId)
  ) {
    await handleQuoteDelete(interaction);
    return;
  }
  // 📋 実行ログ用のメタ情報（本文そのものは残さず、文字数だけを数える）
  let route: CommandRoute;
  let chars: number;
  if (
    interaction.isMessageContextMenuCommand() &&
    interaction.commandName === QUOTE_MESSAGE_COMMAND
  ) {
    route = "context";
    chars = quoteTextLength(interaction.targetMessage.content.trim());
  } else if (
    interaction.isChatInputCommand() &&
    interaction.commandName === QUOTE_SLASH_COMMAND
  ) {
    route = "slash";
    chars = quoteTextLength(interaction.options.getString("text") ?? "");
  } else {
    return;
  }
  const meta = {
    cmd: "quote",
    route,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    userId: interaction.user.id,
    chars,
  };
  try {
    if (route === "context" && interaction.isMessageContextMenuCommand()) {
      await handleQuoteMessage(interaction);
    } else if (route === "slash" && interaction.isChatInputCommand()) {
      await handleQuoteSlash(interaction);
    }
    logExecution({ ...meta, ok: true });
  } catch (e) {
    logExecution({ ...meta, ok: false, error: e });
    console.error("画像生成に失敗しました:", e);
    const msg = {
      content: "画像の生成に失敗しました。時間をおいてもう一度お試しください。",
    };
    try {
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(msg);
        } else {
          await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral });
        }
      }
    } catch {
      // 📝 応答自体が失敗した場合はログのみ
    }
  }
});

// 🔑 ログイン失敗（トークン無効・ネットワーク障害など）は未処理 rejection に
// せず、原因をログに残して異常終了する
try {
  await client.login(config.token);
} catch (e) {
  console.error(
    "ログインに失敗しました。DISCORD_TOKEN とネットワークを確認してください:",
    e,
  );
  process.exitCode = 1;
}
