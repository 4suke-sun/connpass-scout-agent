---
name: license-check
description: npm または Python の新規依存関係を追加する際に使用する。ライセンス互換性を検証し（本番依存に GPL/AGPL 不可）、THIRD_PARTY_LICENSES.json を更新し、NOTICE ファイルを確認する。依存関係変更のマージ前に必須。
---

# ライセンスチェックスキル

## 使用タイミング
`package.json` または `requirements.txt` に新しい依存関係を追加する前。

## 手順

1. インストール前にパッケージの**ライセンスを確認**する:
   ```bash
   npm view <package-name> license
   ```

2. **禁止ライセンス**（追加不可）:
   - GPL-2.0、GPL-3.0
   - AGPL-1.0、AGPL-3.0
   - LGPL（ケースバイケースで評価、人間に確認）
   - ライセンス未記載 / 不明

3. **依存関係追加後**、ライセンスマニフェストを更新する:
   ```bash
   npm run licenses
   ```

4. **`THIRD_PARTY_LICENSES.json`** が正しく更新されたことを確認する。

5. 新しいパッケージが帰属表示を必要とする場合、**`NOTICE`** を更新する。

## 許可ライセンス
MIT、Apache-2.0、BSD-2-Clause、BSD-3-Clause、ISC、CC0-1.0、0BSD、Unlicense（ケースバイケース）
