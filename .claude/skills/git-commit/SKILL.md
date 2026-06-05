---
name: git-commit
description: git commit の前に毎回使用する。ステージされた変更が lint・typecheck・シークレットスキャンを通過することを確認し、Conventional Commits 形式のメッセージを作成する。git commit --amend は使用禁止。
---

# Git Commit スキル

## 使用タイミング
`git commit` を実行する前。

## 手順

1. `npm run lint` を実行 — エラーがあれば先に修正する。
2. `npm run typecheck` を実行 — エラーがあれば先に修正する。
3. `git diff --cached` を実行 — 意図したファイルのみがステージされていることを確認する。
4. シークレットの確認: diff に AKIA*、sk-*、ghp_*、PEM ヘッダーが含まれていないこと。
5. Conventional Commits に従ってコミットメッセージを作成:
   ```
   type(scope): description
   
   [任意の本文]
   ```
   タイプ: `feat` `fix` `chore` `refactor` `docs` `test` `style` `ci` `perf`
6. コミット: `git commit -m "$(cat <<'EOF'\n<message>\nEOF\n)"`

## ルール

- 1コミットにつき1つの論理的変更。
- 公開済みコミットに `--amend` を使用しない。
- フックをスキップしない（`--no-verify` 禁止）。
- ステージされた変更にシークレットが検出された場合 → アンステージし、シークレットを削除し、再ステージする。
