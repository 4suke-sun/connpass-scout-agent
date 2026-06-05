---
name: create-pull-request
description: GitHub プルリクエストを作成する際に使用する。PRテンプレートを記入し、CIが通る見込みを確認し、gh pr create を実行する。PRのマージは絶対に行わない — それはレビュアーの仕事。
---

# プルリクエスト作成スキル

## 使用タイミング
ブランチをプッシュした後、ユーザーにレビューを依頼する前。

## 事前チェック

1. まず `self-review-checklist` スキルを実行する。
2. ブランチがプッシュ済みであることを確認: `git push -u origin <branch>`
3. ローカルで CI が通ることを確認: `npm run lint && npm run typecheck && npm run test && npm run build`

## PR 本文テンプレート

```
## 変更内容
<何を変更したか>

## 変更理由
<なぜこの変更が必要か>

## テスト方法
<変更の検証方法>

## 影響範囲
<他に影響を受ける可能性のある箇所>

## ロールバック手順
<必要な場合の戻し方>

## チェックリスト
- [ ] テストが全て通過
- [ ] lint/typecheck グリーン
- [ ] secrets なし
- [ ] ライセンス互換性確認済み
- [ ] CLAUDE.md の規約に準拠
```

## PR 作成

```bash
gh pr create --base main --title "<type>: <description>" --body "$(cat <<'EOF'
<記入済みテンプレート>
EOF
)"
```

## ルール

- **絶対にマージしない** — マージはレビュアーのみが行う。
- 必須レビュアーを最低1名設定する。
- タイトルは Conventional Commits 形式に従う。
