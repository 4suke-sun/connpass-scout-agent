---
name: install-framework
description: 既存リポジトリに ai-auto-dev-framework のガードレール（.claude/、CLAUDE.md、CI ワークフロー、lefthook）を導入する。新規テンプレートではなく、既に開発が進んでいるプロジェクトに後から適用する場合に使用する。
---

# 既存リポへのフレームワーク導入スキル

## 使用タイミング
既存のプロジェクトリポジトリに ai-auto-dev-framework のガードレールを後から導入したい場合。

## 前提条件
- 対象リポのルートディレクトリで実行すること
- `gh` CLI がインストール済みで認証済みであること
- git の作業ツリーがクリーンであること（未コミットの変更がない）

## 手順

### 1. フレームワークファイルの取得

```bash
# テンプレートリポから必要なファイルだけ取得
git remote add framework https://github.com/4suke-sun/ai-auto-dev-framework.git 2>/dev/null || true
git fetch framework main
```

### 2. プロジェクト非依存ファイルのコピー（そのまま使える）

```bash
# .claude/ ディレクトリ（スキル + フック）
git checkout framework/main -- .claude/

# CLAUDE.md（開発憲法）
git checkout framework/main -- CLAUDE.md

# エディタ設定
git checkout framework/main -- .editorconfig
```

### 3. プロジェクト依存ファイルの選択的コピー

以下は既存の設定と競合する可能性がある。**既にある場合はマージが必要**:

```bash
# CI ワークフロー（既存の .github/workflows/ がある場合は手動マージ）
git checkout framework/main -- .github/workflows/gitleaks.yml
git checkout framework/main -- .github/workflows/codeql.yml
git checkout framework/main -- .github/workflows/security-review.yml
git checkout framework/main -- .github/dependabot.yml
git checkout framework/main -- .github/CODEOWNERS
git checkout framework/main -- .github/pull_request_template.md

# Gitleaks 設定
git checkout framework/main -- .gitleaks.toml
```

### 4. lefthook の導入（オプション）

既存の git hooks や husky がある場合はスキップ。

```bash
# lefthook がまだない場合のみ
git checkout framework/main -- lefthook.yml
npm install --save-dev lefthook
npx lefthook install
```

### 5. CLAUDE.md のカスタマイズ

CLAUDE.md の以下のセクションをプロジェクトに合わせて書き換える:

- **What（プロジェクトマップ）** — 実際のディレクトリ構成に変更
- **ブランチ規約** — 既存のブランチ戦略に合わせる（必要なら）
- **Progressive Disclosure** — 存在しないドキュメントへの参照を削除

### 6. 不要なファイルの削除

テンプレート固有のファイルで不要なものを削除:

```bash
# テンプレートのスケルトンソース（自分のコードがある場合）
rm -rf src/index.ts src/index.test.ts

# テンプレートの TypeScript 設定（別の言語の場合）
# rm tsconfig.json biome.json
```

### 7. リモートの削除

```bash
git remote remove framework
```

### 8. 動作確認

```bash
# フックが動作するか確認
git status
npm run lint 2>/dev/null || echo "lint スクリプトなし — CI に合わせて設定してください"
```

### 9. コミット

```bash
git add .claude/ CLAUDE.md .editorconfig .github/ .gitleaks.toml lefthook.yml
git commit -m "chore: ai-auto-dev-framework のガードレールを導入"
```

### 10. GitHub Settings の設定

`setup-repository` スキルを実行して GitHub 側の設定を行う:

```
/setup-repository
```

## 導入後のアップデート

テンプレートが更新された場合、以下で最新を取り込める:

```bash
git remote add framework https://github.com/4suke-sun/ai-auto-dev-framework.git 2>/dev/null || true
git fetch framework main
# 必要なファイルだけ選択的に更新
git checkout framework/main -- .claude/skills/ .claude/hooks/
git remote remove framework
git commit -m "chore: フレームワークのスキル・フックを最新に更新"
```

## 完了条件

- [ ] `.claude/skills/` が配置されている
- [ ] `.claude/hooks/` が配置されている
- [ ] `CLAUDE.md` がプロジェクトに合わせてカスタマイズされている
- [ ] gitleaks ワークフローが `.github/workflows/` にある
- [ ] `setup-repository` スキルで GitHub Settings が設定済み

## 注意事項

- 既存の CI（`.github/workflows/ci.yml` 等）は上書きしない。セキュリティ系ワークフローのみ追加する
- 既存の `.gitignore`、`package.json`、言語固有の設定は変更しない
- `biome.json` や `tsconfig.json` は TypeScript プロジェクトの場合のみ参考にする
