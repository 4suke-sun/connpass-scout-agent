#!/usr/bin/env bash
# Blocks destructive git operations in Claude Code auto-mode.
set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

block() {
  echo "BLOCKED: $1" >&2
  exit 2
}

# git push --force / -f
if echo "$COMMAND" | grep -qE 'git\s+push\s+(.*\s)?(-f|--force)'; then
  block "git push --force is prohibited. Use a PR instead."
fi

# git reset --hard
if echo "$COMMAND" | grep -qE 'git\s+reset\s+(.*\s)?--hard'; then
  block "git reset --hard is prohibited."
fi

# git clean -f
if echo "$COMMAND" | grep -qE 'git\s+clean\s+(.*\s)?-[a-zA-Z]*f'; then
  block "git clean -f is prohibited."
fi

# git checkout -- (restore files)
if echo "$COMMAND" | grep -qE 'git\s+checkout\s+--'; then
  block "git checkout -- is prohibited. Discarding working tree changes is not allowed."
fi

# git branch -D
if echo "$COMMAND" | grep -qE 'git\s+branch\s+(.*\s)?-D'; then
  block "git branch -D is prohibited. Use -d for safe deletion."
fi

# git commit --amend
if echo "$COMMAND" | grep -qE 'git\s+commit\s+(.*\s)?--amend'; then
  block "git commit --amend is prohibited. Create a new commit instead."
fi

# rm -rf /  (root deletion)
if echo "$COMMAND" | grep -qE 'rm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+/[[:space:]]*$'; then
  block "rm -rf / is prohibited."
fi

exit 0
