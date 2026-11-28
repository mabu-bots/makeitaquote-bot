# CI について

GitHub Actions の CI（`.github/workflows/ci.yml`）は、main への push と
Pull Request で実行されます（ドキュメントのみの変更は対象外）。

実行内容:

1. 依存関係のインストール（`npm ci`）
2. Prettier の整形チェック（`npm run format:check`）
3. 型チェック（`npm run typecheck`）
4. ビルド（`npm run build`）
5. 単体テスト（`npm test`）
6. 依存関係の監査（`npm audit`、失敗してもジョブは止めない）

ローカルでは `./build.sh`（Windows は `build.bat`）が同じ流れ
（インストール → 型チェック → ビルド → テスト）を再現します。
