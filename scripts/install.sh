#!/usr/bin/env bash
set -euo pipefail

# ai-auto-dev-framework installer
# Usage: curl -fsSL https://raw.githubusercontent.com/4suke-sun/ai-auto-dev-framework/main/scripts/install.sh | bash

REPO="https://github.com/4suke-sun/ai-auto-dev-framework.git"
REMOTE_NAME="framework"
BRANCH="main"

echo "🔧 ai-auto-dev-framework installer"
echo "===================================="

# Check if we're in a git repo
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  echo "❌ Error: Not inside a git repository. Run this from your project root."
  exit 1
fi

# Check for clean working tree
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ Error: Working tree is not clean. Commit or stash your changes first."
  exit 1
fi

# Add temporary remote
echo "📥 Fetching framework files..."
git remote add "$REMOTE_NAME" "$REPO" 2>/dev/null || git remote set-url "$REMOTE_NAME" "$REPO"
git fetch "$REMOTE_NAME" "$BRANCH" --quiet

# Copy project-independent files
echo "📂 Copying guardrail files..."
git checkout "$REMOTE_NAME/$BRANCH" -- .claude/ CLAUDE.md .editorconfig .gitleaks.toml

# Copy security workflows
echo "🔒 Copying security workflows..."
mkdir -p .github/workflows
git checkout "$REMOTE_NAME/$BRANCH" -- .github/workflows/gitleaks.yml .github/workflows/codeql.yml
git checkout "$REMOTE_NAME/$BRANCH" -- .github/workflows/security-review.yml
git checkout "$REMOTE_NAME/$BRANCH" -- .github/dependabot.yml
git checkout "$REMOTE_NAME/$BRANCH" -- .github/CODEOWNERS .github/pull_request_template.md

# Clean up remote
git remote remove "$REMOTE_NAME"

# Stage and commit
echo "💾 Committing..."
git add -A
git commit -m "chore: add ai-auto-dev-framework guardrails" --quiet

echo ""
echo "✅ Done! Framework guardrails installed."
echo ""
echo "Next steps:"
echo "  1. Edit CLAUDE.md — update the 'What (Project Map)' section for your project"
echo "  2. Edit .github/CODEOWNERS — set your team as reviewers"
echo "  3. Open Claude Code and run: setup-repository"
echo "     (This configures GitHub Settings: branch protection, CodeQL, auto-merge)"
