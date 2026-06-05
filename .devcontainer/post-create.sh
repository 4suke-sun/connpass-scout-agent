#!/usr/bin/env bash
set -euo pipefail

echo "Setting up development environment..."

# Install dependencies
npm install

# Install git hooks
npm run prepare 2>/dev/null || lefthook install

echo "Setup complete. Run 'npm run lint && npm run test' to verify."
