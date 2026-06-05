---
name: setup-repository
description: テンプレートから作成した新規リポジトリの初期設定を行う。GitHub Settings（Code Scanning、ブランチ保護、Auto-merge）を gh CLI で自動構成する。テンプレート利用直後に1回だけ実行すること。
---

# リポジトリ初期設定スキル

## 使用タイミング
テンプレートからリポジトリを作成した直後に1回だけ実行する。

## 前提条件
- `gh` CLI がインストール済みで認証済みであること
- リポジトリの admin 権限を持っていること

## 手順

### 1. リポジトリ情報の取得

```bash
gh repo view --json nameWithOwner -q '.nameWithOwner'
```

以降のコマンドで `OWNER/REPO` として使用する。

### 2. ブランチ保護ルールの設定

**solo モード（デフォルト推奨）**: レビュアー不要、CI グリーンで自分でマージ可能

```bash
bash scripts/branch-protection.sh --mode solo
```

**team モード**: レビュアー 1名必須、CODEOWNERS に設定されたレビュアーの承認が必要

```bash
bash scripts/branch-protection.sh --mode team
```

現在の設定を確認する:

```bash
bash scripts/branch-protection.sh --status
```

> **solo / team の使い分け**: solo モードは 1人運用や初期開発期に適している。
> チームが 2名以上になったとき、または機密性の高いコードを扱うときに team モードへ切り替える。

### 3. Auto-merge の有効化

```bash
gh repo edit OWNER/REPO --enable-auto-merge
```

有効にすると、PR 作成後に CI グリーンで自動的にマージされる。
自動マージを使わない場合はスキップしてよい。

### 4. Dependabot アラートの有効化

```bash
gh api /repos/OWNER/REPO/vulnerability-alerts -X PUT
```

### 5. 設定確認

```bash
bash scripts/branch-protection.sh --status
```

## solo ↔ team 切り替え

運用状況に応じていつでも切り替えられる:

```bash
# 1人運用に戻す
bash scripts/branch-protection.sh --mode solo

# チーム開発に移行する
bash scripts/branch-protection.sh --mode team
```

## 完了条件

- [ ] main ブランチに保護ルールが設定されている（`--status` で確認）
- [ ] solo または team モードが運用状況に合っている
- [ ] Auto-merge の要否を決定した
- [ ] Dependabot アラートが有効

## エラー時の対応

| エラー | 原因 | 対処 |
|--------|------|------|
| `Resource not accessible by integration` | トークンの権限不足 | `gh auth refresh -s admin:org,repo` で再認証 |
| `Not Found` | リポが存在しない or admin 権限なし | リポ名とアクセス権を確認 |
| `Advanced Security must be enabled` | Free プランのプライベートリポ | public にするか CodeQL をスキップ |
