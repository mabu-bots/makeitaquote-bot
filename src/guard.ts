// ==========================================
// 🛡️ 6. 利用制限（文字数上限・クールダウン・同時実行数）
// ==========================================
// ⚠️ 名言画像の生成はアバター取得と Canvas 描画を伴う重い処理なので、
// 入口で次の3点を強制する。
// - 引用文は最大300文字（/quote の setMaxLength と同じ値を共有する）
// - ユーザー単位の簡易クールダウンで連打を抑える
// - 同時描画数のセマフォで並行実行を絞る
// いずれも純ロジックとして切り出し、単体テストで検証できるようにする。

// 🔤 引用文の最大文字数。/quote のコマンド定義とコンテキストメニュー
// 経路で共有する。
export const MAX_QUOTE_TEXT_LENGTH = 300;

// ⏱️ 同一ユーザーが再実行できるまでの間隔（ミリ秒）
export const COOLDOWN_MS = 10_000;

// 🚦 同時に描画してよい件数。メモリに余裕のない共用サーバー前提で
// 小さく抑える。
export const MAX_CONCURRENT_RENDERS = 2;

// 🔢 文字数はコードポイント単位で数える（絵文字などを1文字として扱う）
export function quoteTextLength(text: string): number {
  return [...text].length;
}

// 🔍 引用文が最大文字数を超えているかどうか
export function exceedsQuoteTextLength(text: string): boolean {
  return quoteTextLength(text) > MAX_QUOTE_TEXT_LENGTH;
}

// ------------------------------------------
// ⏱️ ユーザー単位クールダウン
// ------------------------------------------
export class CooldownTracker {
  private readonly lastStartedAt = new Map<string, number>();

  constructor(private readonly cooldownMs: number = COOLDOWN_MS) {}

  // ⏱️ クールダウン中なら残りミリ秒、そうでなければ 0 を返す（記録はしない）
  remainingMs(userId: string, now: number = Date.now()): number {
    const last = this.lastStartedAt.get(userId);
    if (last === undefined) return 0;
    const remaining = this.cooldownMs - (now - last);
    return remaining > 0 ? remaining : 0;
  }

  // 📝 実行開始を記録する。たまった期限切れエントリはついでに掃除する
  record(userId: string, now: number = Date.now()): void {
    if (this.lastStartedAt.size >= 1000) {
      for (const [id, at] of this.lastStartedAt) {
        if (now - at >= this.cooldownMs) this.lastStartedAt.delete(id);
      }
    }
    this.lastStartedAt.set(userId, now);
  }

  // ▶️ 開始できる場合は記録して 0 を、クールダウン中は残りミリ秒を返す
  tryStart(userId: string, now: number = Date.now()): number {
    const remaining = this.remainingMs(userId, now);
    if (remaining > 0) return remaining;
    this.record(userId, now);
    return 0;
  }
}

// ------------------------------------------
// 🚦 同時描画数セマフォ（空きがなければ待たせずに弾く）
// ------------------------------------------
export class RenderSemaphore {
  private active = 0;

  constructor(
    private readonly maxConcurrent: number = MAX_CONCURRENT_RENDERS,
  ) {}

  // 🔢 現在描画中の件数
  get activeCount(): number {
    return this.active;
  }

  // 🎫 スロットを取れたら true。満杯なら false（呼び出し側は利用者に
  // 待つよう返す）
  tryAcquire(): boolean {
    if (this.active >= this.maxConcurrent) return false;
    this.active += 1;
    return true;
  }

  // 🔓 描画スロットを1つ解放する
  release(): void {
    if (this.active > 0) this.active -= 1;
  }
}
