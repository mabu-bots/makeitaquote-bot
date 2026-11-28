// ==========================================
// 👤 3. アバター取得
// ==========================================
// 👤 URL からアバター画像を取得する。失敗したら null を返し、呼び出し側が
// fallbackAvatar（頭文字画像）に切り替える。
// 取得先は Discord CDN のみ許可し、サイズ上限も設ける（異常に大きい応答で
// メモリを圧迫しないため）。現行の呼び出し元は discord.js が生成する
// displayAvatarURL のみだが、関数単体でも安全側に倒す。
import { loadImage, type Canvas, type Image } from "@napi-rs/canvas";
import { fallbackAvatar } from "./renderer.js";

// 📦 アバター画像のサイズ上限（512px の PNG アバターは通常これより十分小さい）
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

// 🌐 取得を許可するホスト（Discord CDN）
const ALLOWED_AVATAR_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
]);

// 🔍 URL が取得許可先（https + Discord CDN）かどうか
export function isAllowedAvatarUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" && ALLOWED_AVATAR_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

// 📏 Content-Length ヘッダがサイズ上限を超えているかどうか。
// ヘッダが無い・数値でない場合はここでは判定せず、実バイト数で再確認する。
export function isOverAvatarSizeLimit(contentLength: string | null): boolean {
  if (contentLength === null) return false;
  const bytes = Number(contentLength);
  return Number.isFinite(bytes) && bytes > MAX_AVATAR_BYTES;
}

// 📥 URL からアバター画像を取得する（失敗したら null）
export async function fetchAvatar(url: string): Promise<Image | null> {
  try {
    if (!isAllowedAvatarUrl(url)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    if (isOverAvatarSizeLimit(res.headers.get("content-length"))) return null;
    const contentType = res.headers.get("content-type");
    if (contentType !== null && !contentType.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // 🔍 Content-Length が無い・偽装されている場合の最終確認
    if (buf.byteLength > MAX_AVATAR_BYTES) return null;
    return await loadImage(buf);
  } catch {
    return null;
  }
}

// 👤 取得できなければ頭文字の代替画像を返す、最終的に必ず描画対象を返す版
export async function avatarOrFallback(
  url: string,
  displayName: string,
): Promise<Image | Canvas> {
  const img = await fetchAvatar(url);
  return img ?? fallbackAvatar(displayName);
}
