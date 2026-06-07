#!/usr/bin/env bash
# Scans user prompt for secrets before sending to Claude.
# Based on dwarvesf/claude-guardrails (MIT License).
set -euo pipefail

INPUT=$(cat)

if ! command -v jq &>/dev/null; then
  exit 0
fi

PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""' 2>/dev/null || echo "")

check_pattern() {
  local pattern="$1"
  local description="$2"
  if echo "$PROMPT" | grep -qE "$pattern"; then
    echo "BLOCKED: Possible secret detected in prompt: $description" >&2
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
