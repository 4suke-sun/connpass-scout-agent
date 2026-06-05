#!/usr/bin/env bash
# Verifies npm/pip packages exist before installation to prevent hallucinated package attacks.
set -euo pipefail

INPUT=$(cat)

if ! command -v jq &>/dev/null; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

check_npm_package() {
  local pkg="$1"
  # Strip version specifiers
  pkg=$(echo "$pkg" | sed 's/@[^@]*$//' | sed 's/[@^~>=<].*//')
  [[ -z "$pkg" || "$pkg" == -* ]] && return 0
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://registry.npmjs.org/${pkg}" 2>/dev/null || echo "000")
  if [[ "$status" == "404" ]]; then
    echo "BLOCKED: npm package '${pkg}' not found in registry (possible hallucination)." >&2
    exit 2
  fi
}

check_pip_package() {
  local pkg="$1"
  pkg=$(echo "$pkg" | sed 's/[>=<].*//' | sed 's/\[.*//')
  [[ -z "$pkg" || "$pkg" == -* ]] && return 0
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "https://pypi.org/pypi/${pkg}/json" 2>/dev/null || echo "000")
  if [[ "$status" == "404" ]]; then
    echo "BLOCKED: pip package '${pkg}' not found on PyPI (possible hallucination)." >&2
    exit 2
  fi
}

if echo "$COMMAND" | grep -qE 'npm (install|i|add)\b'; then
  PACKAGES=$(echo "$COMMAND" | grep -oP '(?<=npm (install|i|add) ).*' | tr ' ' '\n' | grep -v '^-' || true)
  for pkg in $PACKAGES; do
    check_npm_package "$pkg"
  done
fi

if echo "$COMMAND" | grep -qE 'pip install\b'; then
  PACKAGES=$(echo "$COMMAND" | grep -oP '(?<=pip install ).*' | tr ' ' '\n' | grep -v '^-' || true)
  for pkg in $PACKAGES; do
    check_pip_package "$pkg"
  done
fi

exit 0
