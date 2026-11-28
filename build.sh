#!/usr/bin/env bash
# ==========================================
# 🔨 makeitaquote-bot のフルビルド（ワンコマンド）
# ==========================================
# 依存関係のインストール → 型チェック → ビルド → テスト を順に実行し、
# 失敗したステップで即座に止まって、どのステップで落ちたかを表示する。
# テストは dist/ に対して実行されるため、ビルドをテストより先に行う。

# ===== 1. 準備 =====
set -euo pipefail
cd "$(dirname "$0")"

step() {
  echo
  echo "===== $1 ====="
}

fail() {
  echo "ERROR: ステップが失敗しました: $1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "前提チェック (Node.js が見つかりません)"
command -v npm >/dev/null 2>&1 || fail "前提チェック (npm が見つかりません)"

# ===== 2. 依存関係のインストール =====
step "1/4 依存関係のインストール"
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund || fail "依存関係のインストール (npm ci)"
else
  npm install --no-audit --no-fund || fail "依存関係のインストール (npm install)"
fi

# ===== 3. 型チェック =====
step "2/4 型チェック (npm run typecheck)"
npm run typecheck || fail "型チェック (npm run typecheck)"

# ===== 4. ビルド =====
step "3/4 ビルド (npm run build)"
npm run build || fail "ビルド (npm run build)"

# ===== 5. テスト =====
step "4/4 テスト (npm test)"
npm test || fail "テスト (npm test)"

# ===== 6. 完了 =====
echo
echo "BUILD OK: makeitaquote-bot のビルドとテストがすべて成功しました (成果物: dist/)"
