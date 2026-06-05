#!/usr/bin/env bash
# Scans staged changes for secrets before git commit.
# Based on dwarvesf/claude-guardrails (MIT License).
set -euo pipefail

INPUT=$(cat)

if ! command -v jq &>/dev/null; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

# Only run when command contains "git commit"
if ! echo "$COMMAND" | grep -qwE 'git[[:space:]]+commit'; then
  exit 0
fi

DIFF=$(git diff --cached 2>/dev/null || echo "")
ADDED_LINES=$(echo "$DIFF" | grep '^+' | grep -v '^+++' || true)

check_pattern() {
  local pattern="$1"
  local description="$2"
  if echo "$ADDED_LINES" | grep -qE "$pattern"; then
    echo "BLOCKED: Possible secret in staged changes: $description" >&2
    exit 2
  fi
}

check_pattern 'AKIA[A-Z0-9]{16}' "AWS Access Key ID"
check_pattern 'AIza[0-9A-Za-z\-_]{35}' "Google API Key"
check_pattern '(ghp|gho|ghs)_[A-Za-z0-9]{36}' "GitHub Token"
check_pattern 'sk-ant-[A-Za-z0-9\-_]{95}' "Anthropic API Key"
check_pattern 'sk-[A-Za-z0-9]{48}' "OpenAI API Key"
check_pattern '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----' "PEM Private Key"
check_pattern 'xox[baprs]-[0-9A-Za-z\-]+' "Slack Token"

exit 0
