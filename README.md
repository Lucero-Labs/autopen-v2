# autopen-v2

A **signing and evidence core**. Given a pre-built PDF and a set of
precondition rules, it gates the document, seals it, runs a signature ceremony
through [Lakaut](https://lakautac.com.ar), an Argentine certifying authority,
ingests the signed artefact and assembles a verifiable evidence bundle.

The first document is an Argentine *pagaré*; its rule set is
`packages/rules-pagare-ar`.

## Where to look

| Question | Read |
| --- | --- |
| Why is the core shaped this way? | `docs/research/RESULT-001-core-signing-evidence.md` §1–§3, then the `ADDENDUM` |
| What is the work? | The open GitHub issues |
| How is a ticket designed before coding? | `docs/design/` |
| What does the vendor actually say? | `docs/vendor/lakaut/` — a faithful mirror at SDK `0.1.0-rc.40` |
| What did the prototype look like? | `docs/vendor/prototipo/` |
| How do I work in this repo? | [`AGENTS.md`](AGENTS.md) (the repo), [`STYLES.md`](STYLES.md) (the code) |

## What exists

```
packages/core/             contracts + error classes. Zero dependencies.
packages/gate/             PolicyGate engine, InMemoryPolicyRegistry, rule factories
packages/rules-pagare-ar/  the Argentine pagaré rule set
apps/                      deployable products (empty so far — see apps/README.md)
```

`@autopen/gate` decides whether a subject may proceed to an irreversible step,
knowing nothing about what it is gating. `@autopen/rules-pagare-ar` is the first
policy registered with it; `packages/gate/README.md` shows how to compose one.

The Lakaut adapter, the seal operation, ingest and the evidence bundle are on
the backlog. The multi-party signature question that shapes several of them is
blocked on sandbox credentials (AGENTS.md, "Blocked on credentials").

## Running it

Node 22 and pnpm 10.11.1, both pinned (`.nvmrc`, `packageManager`). With Corepack
enabled, pnpm installs itself at the right version.

```bash
pnpm install --frozen-lockfile
pnpm check        # biome — format + lint (`check:fix` to apply)
pnpm build        # tsc per package → dist/
pnpm typecheck
pnpm test         # vitest
pnpm verify       # all of the above, in order — scripts/verify.sh
```

`pnpm verify` is the one command that must pass identically on a laptop and in a
Claude Code cloud session. Filter to one package with
`pnpm test --filter=@autopen/gate`.
