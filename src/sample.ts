// ==========================================
// 🧪 15. サンプル画像生成（npm run sample）
// ==========================================
// 🧪 Discord に接続せず、レンダラの見た目確認用に docs/sample.png を作る。
// アバターは人物シルエット風のダミー画像をその場で描く。
import { createCanvas } from "@napi-rs/canvas";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderQuoteImage } from "./quote/renderer.js";

// 📁 プロジェクトルート（package.json のある階層）を上方向に探す
function projectRoot(): string {
  let dir = fileURLToPath(new URL(".", import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("package.json が見つかりません");
}

// 🎭 人物シルエット風のダミーアバターを描く
function dummyAvatar() {
  const s = 630;
  const c = createCanvas(s, s);
  const ctx = c.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, s, s);
  grad.addColorStop(0, "#8a93a5");
  grad.addColorStop(1, "#4a5064");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  // 👤 人物シルエット（頭と肩）
  ctx.fillStyle = "#2c2f38";
  ctx.beginPath();
  ctx.arc(s / 2, s * 0.42, s * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(s / 2, s * 0.98, s * 0.34, s * 0.3, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  return c;
}

const png = await renderQuoteImage({
  text: "明日から本気出すって、昨日も言ってた気がするんだよな",
  displayName: "まぶ",
  username: "xx_mabu_xx",
  avatar: dummyAvatar(),
  variant: "exact", // 資料用サンプルは高精度版（本家完全一致）で作る
});
const docsDir = join(projectRoot(), "docs");
mkdirSync(docsDir, { recursive: true });
writeFileSync(join(docsDir, "sample.png"), png);
console.log("docs/sample.png を生成しました:", png.length, "bytes");
