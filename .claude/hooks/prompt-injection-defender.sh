#!/usr/bin/env bash
# Warns about potential prompt injection in tool output.
# Warning only (exit 0) — does not block.
# Based on dwarvesf/claude-guardrails (MIT License).
set -euo pipefail

INPUT=$(cat)

if ! command -v jq &>/dev/null; then
  exit 0
fi

CONTENT=$(echo "$INPUT" | jq -r '(.tool_result // .output // "") | tostring' 2>/dev/null || echo "")

warn_pattern() {
  local pattern="$1"
  local description="$2"
  if echo "$CONTENT" | grep -qiE "$pattern"; then
    echo "WARNING: Possible prompt injection detected: $description" >&2
  fi
}

warn_pattern 'disregard prior|ignore previous instructions|ignore all previous' "Instruction override attempt"
warn_pattern 'you are now|act as|pretend you are' "Role override attempt"
warn_pattern 'bypass restrictions|sudo mode|developer mode enabled' "Restriction bypass attempt"
warn_pattern '<system>|</system>' "System tag injection"
warn_pattern '[A-Za-z0-9+/]{100,}={0,2}' "Possible base64-encoded instructions"

exit 0
