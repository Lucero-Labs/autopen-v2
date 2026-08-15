# autopen-v2

Integration built on the Lakaut AC SDK (`@lakaut/server`, `@lakaut/browser`).

## Toolchain

Pinned to match the Claude Code cloud session image (Ubuntu 24.04 x86_64):

- Node 22 (`.nvmrc`, `engines`)
- pnpm 10.11.1 (via Corepack, `packageManager`)

## Verify

```bash
pnpm verify
```

This is the one command that must pass identically on a laptop and in a cloud
session. If it's green in both places, the environments are compatible.
