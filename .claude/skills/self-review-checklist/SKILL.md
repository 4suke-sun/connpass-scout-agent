---
name: self-review-checklist
description: タスク完了前に毎回実行する。テスト通過・カバレッジ閾値達成・シークレット未コミット・ライセンスチェック合格・Conventional Commits 準拠・PRテンプレート記入済みを検証する。プッシュまたは PR 作成前に使用すること。
---

# セルフレビューチェックリストスキル

## 使用タイミング
ブランチをプッシュする前、または PR を作成する前。

## チェックリスト

各コマンドを実行し、通過することを確認する:

```bash
npm run lint          # Biome lint — グリーンであること
npm run typecheck     # tsc --noEmit — グリーンであること
npm run test          # 全テスト通過
npm run test:coverage # カバレッジ >= lines 50% / branches 40%
npm run build         # ビルド成功
```

続いて以下を確認:

- [ ] `git diff HEAD~1` にシークレットがない（AKIA*、sk-*、ghp_*、PEM ヘッダーなし）
- [ ] すべてのコミットが Conventional Commits に準拠している（`git log --oneline`）
- [ ] 承認されたスコープ外のファイルが変更されていない
- [ ] 依存関係が変更された場合、`THIRD_PARTY_LICENSES.json` が最新である
- [ ] PR テンプレートが完全に記入されている（プレースホルダーテキストなし）

## 失敗した場合

停止する。プッシュしない。まず問題を修正し、このチェックリストを再実行する。
