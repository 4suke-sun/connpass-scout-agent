---
name: security-check
description: 依存関係の追加・認証/暗号コードの変更・リリース前に使用する。gitleaks、npm audit を実行し、CodeQL のステータスを報告する。セキュリティに関わる変更のマージ前に必須。
---

# セキュリティチェックスキル

## 使用タイミング
- 認証・暗号・外部 API 呼び出しに関わる変更をマージする前
- 新しい npm 依存関係を追加する場合
- 定期的に（最低スプリントごとに1回）

## 手順

### 1. シークレットスキャン
```bash
# gitleaks を使用（インストール済みであること）
gitleaks detect --source . --no-git 2>&1 || echo "gitleaks not installed, skipping"

# 手動パターンチェック
git diff HEAD~1 | grep -E 'AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z]{35}|(ghp|gho|ghs)_[A-Za-z0-9]{36}' && echo "SECRET FOUND" || echo "Clean"
```

### 2. 依存関係の監査
```bash
npm audit --audit-level=high
```
続行する前に、high/critical の指摘をすべて修正または確認する。

### 3. ライセンスチェック
```bash
npm run licenses
```
本番依存関係に GPL/AGPL ライセンスがないことを確認する。

### 4. CodeQL
GitHub Actions → CodeQL ワークフローのブランチステータスを確認する。
すべての CodeQL アラートはマージ前に対処すること。

## エスカレーション
git 履歴に実際のシークレットが見つかった場合: 作業を停止し、直ちに人間に通知する。履歴の書き換えを試みてはならない。
