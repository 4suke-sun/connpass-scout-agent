#!/usr/bin/env bash
# main ブランチの保護ルールを solo / team モードで切り替える。
# Usage:
#   scripts/branch-protection.sh --mode solo   # レビュアー不要、CI のみ必須
#   scripts/branch-protection.sh --mode team   # レビュアー 1名必須、管理者にも適用
#   scripts/branch-protection.sh --status      # 現在の設定を表示
set -euo pipefail

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")
if [[ -z "$REPO" ]]; then
  echo "ERROR: gh CLI が認証されていないか、GitHub リポジトリではありません。" >&2
  exit 1
fi

BRANCH="main"
MODE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --status)
      echo "=== $REPO / $BRANCH の保護設定 ==="
      gh api "repos/$REPO/branches/$BRANCH/protection" 2>/dev/null \
        | python3 -c "
import json, sys
d = json.load(sys.stdin)
reviews = d.get('required_pull_request_reviews') or {}
checks  = d.get('required_status_checks') or {}
print('レビュアー必須数:', reviews.get('required_approving_review_count', 0))
print('管理者にも適用:', d.get('enforce_admins', {}).get('enabled', False))
print('線形履歴必須:   ', d.get('required_linear_history', {}).get('enabled', False))
print('force push 禁止:', not d.get('allow_force_pushes', {}).get('enabled', True))
print('必須ステータス: ', [c['context'] for c in checks.get('checks', [])])
" || echo "保護ルール未設定"
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$MODE" ]]; then
  echo "Usage: $0 --mode solo|team  または  $0 --status" >&2
  exit 1
fi

STATUS_CHECKS='["Lint","Typecheck","Test & Coverage","Build"]'

apply_protection() {
  local payload="$1"
  gh api "repos/$REPO/branches/$BRANCH/protection" \
    --method PUT \
    --header "Accept: application/vnd.github+json" \
    --input - <<< "$payload"
}

case "$MODE" in
  solo)
    echo "=== solo モードを適用します ($REPO / $BRANCH) ==="
    echo "  レビュアー必須: なし"
    echo "  必須 CI: Lint / Typecheck / Test & Coverage / Build"
    echo "  管理者適用: なし（オーナーはマージ可能）"
    apply_protection "$(cat <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": $STATUS_CHECKS
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
)"
    echo "✅ solo モード適用完了。CI グリーンで自分でマージできます。"
    ;;

  team)
    echo "=== team モードを適用します ($REPO / $BRANCH) ==="
    echo "  レビュアー必須: 1名（CODEOWNERS）"
    echo "  必須 CI: Lint / Typecheck / Test & Coverage / Build"
    echo "  管理者にも適用: あり"
    apply_protection "$(cat <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": $STATUS_CHECKS
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
)"
    echo "✅ team モード適用完了。CODEOWNERS に設定されたレビュアーの承認が必要です。"
    ;;

  *)
    echo "ERROR: --mode は solo または team を指定してください。" >&2
    exit 1 ;;
esac
