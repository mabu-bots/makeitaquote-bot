// ==========================================
// 📋 11. コマンド実行ログ
// ==========================================
// 📝 コマンドが実行されるたびに標準出力へ1行のメタ情報を残す（pm2 の
// out ログに残る）。起動ログには時刻が付かないため、ISO 形式の
// タイムスタンプを自前で付ける。
// ユーザーの入力テキスト（オプション値・本文）は記録せず、コマンド名・
// ID・成否だけを残す（文字数は可）。書式は全 Bot 共通:
//   [exec] <ISO時刻> cmd=<名前> route=<slash|context|prefix> guild=<ID>
//          channel=<ID> user=<ID> [chars=<文字数>] result=<ok|error>
// 失敗時は末尾に error="<要点>" が付く。

// 📋 コマンドの入口種別
export type CommandRoute = "slash" | "context" | "prefix";

// 📋 実行ログ1件分の情報
export interface ExecutionLogEntry {
  cmd: string;
  route: CommandRoute;
  guildId: string | null;
  channelId: string | null;
  userId: string;
  // 🔢 入力テキストの文字数（本文そのものは記録しない）
  chars?: number;
  ok: boolean;
  error?: unknown;
}

// ✂️ エラーを1行の要点に整形する（空白を潰し、引用符を置換し、
// 長すぎれば切り詰める）
export function summarizeError(error: unknown): string {
  const raw =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const oneLine = raw.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return oneLine.length > 100 ? oneLine.slice(0, 100) + "…" : oneLine;
}

// 📋 実行ログを1行の文字列に整形する
export function formatExecutionLog(
  entry: ExecutionLogEntry,
  now: Date = new Date(),
): string {
  const parts = [
    "[exec]",
    now.toISOString(),
    `cmd=${entry.cmd}`,
    `route=${entry.route}`,
    `guild=${entry.guildId ?? "-"}`,
    `channel=${entry.channelId ?? "-"}`,
    `user=${entry.userId}`,
  ];
  if (entry.chars !== undefined) parts.push(`chars=${entry.chars}`);
  parts.push(`result=${entry.ok ? "ok" : "error"}`);
  if (!entry.ok) parts.push(`error="${summarizeError(entry.error)}"`);
  return parts.join(" ");
}

// 📣 実行ログを標準出力へ出す
export function logExecution(entry: ExecutionLogEntry): void {
  console.log(formatExecutionLog(entry));
}
