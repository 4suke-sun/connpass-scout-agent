#!/usr/bin/env bash
# Records all Bash tool invocations to a structured audit log.
set -euo pipefail

INPUT=$(cat)

if ! command -v jq &>/dev/null; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")
LOG_DIR="${HOME}/.claude/audit-log"
mkdir -p "$LOG_DIR"

DATE=$(date -u +%Y-%m-%d)
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"

printf '{"timestamp":"%s","command":%s,"session_id":"%s"}\n' \
  "$TIMESTAMP" \
  "$(echo "$COMMAND" | jq -Rs '.')" \
  "$SESSION_ID" \
  >> "${LOG_DIR}/${DATE}.jsonl"

exit 0
