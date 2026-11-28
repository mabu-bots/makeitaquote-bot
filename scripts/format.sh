#!/usr/bin/env bash
# ==========================================
# 🖌️ Prettier 一括適用（makeitaquote-bot）
# ==========================================
set -euo pipefail
cd "$(dirname "$0")/.."

npx prettier --write "src/**/*.ts" "tests/**/*.ts" "package.json" "tsconfig.json" "ecosystem.config.cjs" ".github/workflows/*.yml" ".github/dependabot.yml"
