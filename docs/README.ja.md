# ai-auto-dev-framework

> **⚠️ 研究用（Experimental）— 本番環境での利用は非推奨です**
>
> このリポジトリは AI エージェント（Claude Code）を auto-mode で安全に稼働させるための規約・ガードレールを研究・検証する目的で公開しています。
> 本番プロジェクトへの導入は十分な検証の上、自己責任で行ってください。
> 仕様・構成は予告なく破壊的に変更される可能性があります。

**[English README](../README.md)**

---

Auto-mode で Claude Code を継続稼働させても事故ゼロを目指す「開発憲法」テンプレートリポジトリ。
新規プロジェクトのスタート地点として使い、CI・フック・スキルが最初から揃った状態で開発を始められます。

## 含まれるもの

| レイヤー | 場所 | 役割 |
|----------|------|------|
| ガードフック | `.claude/hooks/` | 危険な操作をリアルタイムでブロック |
| スキル | `.claude/skills/` | 人間の承認ゲート付き構造化ワークフロー |
| CI ワークフロー | `.github/workflows/` | 自動品質・セキュリティゲート |
| devcontainer | `.devcontainer/` | 隔離された再現可能な開発環境 |
| エージェントガイド | `docs/agent-guides/` | 各フェーズの詳細手順 |
| 開発憲法 | `CLAUDE.md` | AI エージェントが常時参照するルールブック |

## クイックスタート

### 1. テンプレートからリポジトリを作成

```bash
gh repo create my-project --template 4suke-sun/ai-auto-dev-framework --private
cd my-project
npm install
```

または GitHub 上で **Use this template** ボタンをクリック。

### 2. プロジェクトに合わせてカスタマイズ

| ファイル | やること |
|----------|----------|
| `src/` | スケルトンコードを削除し、自分のコードを配置 |
| `package.json` | `name`, `description`, `version` を変更 |
| `CLAUDE.md` | 「What（プロジェクトマップ）」セクションを自分のプロジェクト構成に書き換え |
| `.github/CODEOWNERS` | レビュアーを自分のチームに変更 |
| `tsconfig.json` | 必要に応じて `target` や `lib` を調整 |

### 3. セットアップ確認

```bash
npm run lint         # Biome lint
npm run typecheck    # TypeScript strict check
npm run test         # Vitest
npm run build        # コンパイル
```

4つすべてグリーンになれば準備完了。

### 4. 開発開始

```
Claude Code を起動 → CLAUDE.md を読み込み → スキルに従って開発
```

### 5. GitHub Settings の設定（テンプレートから引き継がれない）

以下の設定はテンプレートからコピーされません。いずれかの方法で設定してください:

#### 方法 A: Claude Code で自動設定（推奨）

Claude Code セッションでセットアップスキルを実行:

```
/setup-repository
```

`gh` CLI を使って Code Scanning、ブランチ保護、Auto-merge を自動構成します。

#### 方法 B: GitHub Web UI で手動設定

| 設定 | パス | 操作 |
|------|------|------|
| Code Scanning | Settings → Code security → Code scanning | 「Setup → Default」をクリックして CodeQL を有効化 |
| ブランチ保護 | Settings → Branches → `main` のルールを追加 | PR 必須、ステータスチェック必須（Lint, Typecheck, Test & Coverage, Build）、CODEOWNERS レビュー必須を有効化 |
| Auto-merge | Settings → General → Pull Requests | dependabot の自動マージを使う場合は「Allow auto-merge」を有効化 |

> **注意（Free プランのプライベートリポ）:** CodeQL と Gitleaks の SARIF アップロードには GitHub Advanced Security が必要で、Free プランのプライベートリポでは利用できません。これらのワークフローは警告を出しますが CI をブロックしません。必要な場合は `codeql.yml` を削除するか、リポを public にしてください。

## 開発フロー

```
issue 作成
  ↓
main から feature ブランチを作成（または dev 経由）
  ↓
ask-if-underspecified スキル（仕様が曖昧な場合）
  ↓
plan スキル → ユーザー承認待ち
  ↓
implement スキル（テストファースト）
  ↓
git-commit スキル（Conventional Commits）
  ↓
self-review-checklist スキル
  ↓
create-pull-request スキル
  ↓
CI 通過 + 人間レビュー → マージ（人間のみ）
```

## 主要な規約

- **シークレット**: ハードコード禁止。`.env` 経由のみ。3層のフックで強制
- **コミット**: [Conventional Commits](https://www.conventionalcommits.org/) — `type(scope): description`
- **ブランチ**: GitHub Flow — 短命な feature ブランチ、squash merge で `main` に統合
- **カバレッジ**: Lines ≥50% / Branches ≥40%（四半期ごとに引き上げ）
- **マージ**: 人間のみ。AI は絶対にマージしない

## Human-in-the-Loop ゲート

Auto-mode は以下のポイントで停止し、人間の承認を待ちます:

1. 実装前の計画承認（plan スキル）
2. 認証操作（gh, クラウド CLI）
3. CLAUDE.md 作成後のレビュー
4. CI 失敗時
5. PR マージ（常に人間）
6. ブランチ保護の検証

詳細: [docs/agent-guides/hitl-gates.md](agent-guides/hitl-gates.md)

## セキュリティ

| フック | タイミング | 役割 |
|--------|-----------|------|
| `scan-secrets.sh` | UserPromptSubmit | プロンプト内のシークレットをブロック |
| `scan-commit.sh` | PreToolUse | ステージされた変更内のシークレットをブロック |
| `block-dangerous-git.sh` | PreToolUse | force-push, reset --hard 等をブロック |
| `prompt-injection-defender.sh` | PostToolUse | ツール出力のインジェクションパターンを警告 |
| `check-package-hallucination.sh` | PreToolUse | 存在しないパッケージのインストールをブロック |
| `gitleaks` | CI | 全履歴のシークレットスキャン |

## CI ワークフロー

| ワークフロー | 内容 | トリガー |
|-------------|------|----------|
| CI | Lint / Typecheck / Test & Coverage / Build | PR + main push |
| CodeQL | 静的セキュリティ解析 | PR + main push + 週次 |
| Gitleaks | シークレットスキャン | PR + main push |
| License Check | GPL/AGPL 検出 | package.json 変更時 |
| Security Review | npm audit (high+) | PR + main push + 週次 |
| Auto-merge Dependabot | patch のみ自動 squash merge | dependabot PR |

## カスタマイズガイド

### 既存リポジトリへの導入

既にプロジェクトがあり、後からガードレールを追加したい場合。

#### ワンライナーで導入

```bash
curl -fsSL https://raw.githubusercontent.com/4suke-sun/ai-auto-dev-framework/main/scripts/install.sh | bash
```

#### 手動で導入（中身を確認したい場合）

```bash
# フレームワークファイルを取得（クローンではない、履歴なし）
git remote add framework https://github.com/4suke-sun/ai-auto-dev-framework.git
git fetch framework main

# ガードレールファイルをプロジェクトにコピー
git checkout framework/main -- .claude/ CLAUDE.md .editorconfig .gitleaks.toml
git checkout framework/main -- .github/workflows/gitleaks.yml .github/workflows/codeql.yml
git checkout framework/main -- .github/workflows/security-review.yml .github/dependabot.yml
git checkout framework/main -- .github/CODEOWNERS .github/pull_request_template.md

# 一時リモートを削除
git remote remove framework

# コミット
git add -A && git commit -m "chore: add ai-auto-dev-framework guardrails"
```

導入後、Claude Code を開いて `setup-repository` を実行すれば GitHub Settings も自動構成されます。

詳細な手順（カスタマイズ含む）: [.claude/skills/install-framework/SKILL.md](../.claude/skills/install-framework/SKILL.md)

### CI のジョブを増減したい

`.github/workflows/ci.yml` を編集。ブランチ保護の required checks も GitHub Settings で合わせて変更。

### スキルを追加したい

`.claude/skills/<skill-name>/SKILL.md` を作成し、`CLAUDE.md` のスキル呼び出しルール表に追加。

### 別の言語で使いたい

`src/`、`tsconfig.json`、`biome.json` を削除し、対象言語のツールチェインに置き換え。
CI の `npm run` コマンドも対応するものに変更。`.claude/skills/` と `CLAUDE.md` はそのまま使える。

## ライセンス

MIT — [LICENSE](../LICENSE) を参照。

サードパーティライセンス: [THIRD_PARTY_LICENSES.json](../THIRD_PARTY_LICENSES.json)
