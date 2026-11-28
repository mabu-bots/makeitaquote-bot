@echo off
rem ==========================================
rem 🔨 makeitaquote-bot のフルビルド（ワンコマンド、Windows 用）
rem ==========================================
rem 依存関係のインストール → 型チェック → ビルド → テスト を順に実行し、
rem 失敗したステップで即座に止まって、どのステップで落ちたかを表示する。
rem テストは dist\ に対して実行されるため、ビルドをテストより先に行う。
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm が見つかりません。Node.js 20 以上をインストールしてください。 1>&2
  exit /b 1
)

echo.
echo ===== 1/4 依存関係のインストール =====
if exist package-lock.json (
  call npm ci --no-audit --no-fund
) else (
  call npm install --no-audit --no-fund
)
if errorlevel 1 goto fail_install

echo.
echo ===== 2/4 型チェック (npm run typecheck) =====
call npm run typecheck
if errorlevel 1 goto fail_typecheck

echo.
echo ===== 3/4 ビルド (npm run build) =====
call npm run build
if errorlevel 1 goto fail_build

echo.
echo ===== 4/4 テスト (npm test) =====
call npm test
if errorlevel 1 goto fail_test

echo.
echo BUILD OK: makeitaquote-bot のビルドとテストがすべて成功しました (成果物: dist\)
exit /b 0

:fail_install
echo ERROR: ステップが失敗しました: 依存関係のインストール 1>&2
exit /b 1

:fail_typecheck
echo ERROR: ステップが失敗しました: 型チェック (npm run typecheck) 1>&2
exit /b 1

:fail_build
echo ERROR: ステップが失敗しました: ビルド (npm run build) 1>&2
exit /b 1

:fail_test
echo ERROR: ステップが失敗しました: テスト (npm test) 1>&2
exit /b 1
