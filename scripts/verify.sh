#!/usr/bin/env bash
# The single command that must pass identically on a laptop and in a cloud session.
# Keep it dependency-light and exit non-zero on the first failure.
set -euo pipefail

echo "node    $(node -v)"
echo "pnpm    $(pnpm -v 2>/dev/null || echo 'not installed')"
echo "arch    $(uname -m)"
echo "remote  ${CLAUDE_CODE_REMOTE:-false}"

pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
pnpm run test

echo "verify: ok"
