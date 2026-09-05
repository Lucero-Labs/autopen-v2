# autopen-v2

A provider-agnostic **signing and evidence core**. A client product hands it a
pre-built PDF and a set of precondition rules; the core gates the document,
seals it, runs a signature ceremony through a certifying provider, ingests the
signed artefact and assembles a verifiable evidence bundle.

The first client product is vehicle-loan origination for Argentine dealerships —
a *pagaré con garantía prendaria* signed by the borrower. The provider is
[Lakaut](https://lakautac.com.ar), an Argentine certifying authority. A second,
different signing product is expected, which is why the core is a set of
importable packages rather than an application.

## Where to look

| Question | Read |
| --- | --- |
| Why is the core shaped this way? | `docs/research/RESULT-001-core-signing-evidence.md` §1–§3, then the `ADDENDUM` |
| What is the work, in order? | `docs/planning/BACKLOG-001-core.md` — 28 tickets, each a GitHub issue |
| How is a ticket designed before coding? | `docs/design/` |
| What does the vendor actually say? | `docs/vendor/lakaut/` — a faithful mirror at SDK `0.1.0-rc.40` |
| What did the product look like? | `docs/vendor/prototipo/` |
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
policy registered with it: *lugar de pago* and *integración de consumo*, the two
rules the prototype uses to block a send. `packages/gate/README.md` shows how to
compose a policy.

The Lakaut adapter, the seal operation, ingest and the evidence bundle are on
the backlog; the multi-party signature question that shapes several of them is
blocked on sandbox credentials (AGENTS.md, "Blocked on credentials").

## Running it

Node 22 and pnpm 10.11.1, both pinned (`.nvmrc`, `packageManager`). With Corepack
enabled, pnpm installs itself at the right version.

```bash
pnpm install --frozen-lockfile
pnpm build        # tsc per package → dist/
pnpm typecheck
pnpm test         # vitest
pnpm verify       # all of the above, in order — scripts/verify.sh
```

`pnpm verify` is the one command that must pass identically on a laptop and in a
Claude Code cloud session (Ubuntu 24.04 x86_64). If it is green in both places,
the environments are compatible. Filter to one package with
`pnpm test --filter=@autopen/gate`.

There is no linter or formatter; `STYLES.md` §1.2 says what to match by hand.
