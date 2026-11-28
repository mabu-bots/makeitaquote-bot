// ==========================================
// 🗄️ 13. 生成画像のサーバー保存（不適切利用の確認用アーカイブ）
// ==========================================
// 🗄️ 生成した名言画像を Bot のサーバー側に保存し、捏造画像が不適切に
// 使われていないかを後から確認できるようにする。保存先は運営者だけが
// 見られるサーバー内（既定: data/archive、server-portal 等で確認する）。
//
// - 画像（PNG）と、1行1件の index.jsonl（いつ・誰が・誰の発言として・
//   どのサーバー/チャンネルで・本文）をセットで残す
// - 無制限に溜めない: 保持は最大30日 かつ 最大1000件。超えた分は
//   古い順に自動削除する（index.jsonl は監査用に残し、画像だけ消す）
// - 保存に失敗しても画像生成自体は失敗させない（呼び出し側で握る）
// - 止めたいときは環境変数 QUOTE_ARCHIVE=off。保存先は
//   QUOTE_ARCHIVE_DIR で変更可
import {
  appendFile,
  mkdir,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export const ARCHIVE_MAX_ITEMS = 1000;
export const ARCHIVE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_ARCHIVE_DIR = "data/archive";

// 🗄️ アーカイブに残す1件分のメタ情報
export interface QuoteArchiveEntry {
  route: "slash" | "context";
  guildId: string | null;
  channelId: string | null;
  messageId: string | null;
  requesterId: string;
  quotedUserId: string;
  text: string;
}

// 🔍 アーカイブ保存が有効かどうか（QUOTE_ARCHIVE=off で無効化）
export function archiveEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = (env.QUOTE_ARCHIVE ?? "").trim().toLowerCase();
  return v !== "off" && v !== "false" && v !== "0";
}

// 📁 アーカイブの保存先ディレクトリ
export function archiveDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.QUOTE_ARCHIVE_DIR?.trim() || DEFAULT_ARCHIVE_DIR;
}

// 🏷️ ファイル名: 時刻順に並ぶよう UTC タイムスタンプ + 作成者 + 引用された人
export function buildArchiveFileName(
  date: Date,
  requesterId: string,
  quotedUserId: string,
): string {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-");
  return `${stamp}_${requesterId}_${quotedUserId}.png`;
}

// 🗄️ アーカイブ画像1件分の情報（ファイル名と更新時刻）
export interface ArchiveFileInfo {
  name: string;
  mtimeMs: number;
}

// 🧹 削除対象の選定（純ロジック）: 保持期間を超えたものを消し、それでも
// 上限件数を超える場合は古い順に消す。対象は .png のみ。
export function selectPruneTargets(
  files: ArchiveFileInfo[],
  now: number,
  maxItems: number = ARCHIVE_MAX_ITEMS,
  maxAgeMs: number = ARCHIVE_MAX_AGE_MS,
): string[] {
  const pngs = files
    .filter((f) => f.name.endsWith(".png"))
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  const targets: string[] = [];
  const fresh = pngs.filter((f) => {
    if (now - f.mtimeMs > maxAgeMs) {
      targets.push(f.name);
      return false;
    }
    return true;
  });
  const excess = fresh.length - maxItems;
  if (excess > 0) {
    for (const f of fresh.slice(0, excess)) targets.push(f.name);
  }
  return targets;
}

// 💾 画像とメタデータを保存し、ついでに古い画像を掃除する
export async function saveQuoteArchive(
  dir: string,
  entry: QuoteArchiveEntry,
  png: Buffer,
  now: Date = new Date(),
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const fileName = buildArchiveFileName(
    now,
    entry.requesterId,
    entry.quotedUserId,
  );
  await writeFile(join(dir, fileName), png);
  const record = { ts: now.toISOString(), file: fileName, ...entry };
  await appendFile(
    join(dir, "index.jsonl"),
    JSON.stringify(record) + "\n",
    "utf8",
  );
  // 🧹 掃除: ディレクトリ内の PNG を数え、保持ルールを超えた古いものを消す
  const names = await readdir(dir);
  const infos: ArchiveFileInfo[] = [];
  for (const name of names) {
    if (!name.endsWith(".png")) continue;
    const s = await stat(join(dir, name));
    infos.push({ name, mtimeMs: s.mtimeMs });
  }
  for (const target of selectPruneTargets(infos, now.getTime())) {
    await unlink(join(dir, target)).catch(() => {});
  }
  return fileName;
}
