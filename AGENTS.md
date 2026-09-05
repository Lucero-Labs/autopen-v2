# AGENTS.md

Guidance for AI coding agents, and for humans new to the repo. It is paired with
[`STYLES.md`](STYLES.md): this file covers what to know about the *repo*
(commands, layout, architecture, the vendor situation); `STYLES.md` covers how
to *write code* here (naming, types, errors, money, secrets, tests, process).

> **Read `STYLES.md` before editing any file.** If your harness loaded this file
> but not that one, open it now. Its rules bind automated reviewers as much as
> authors: a review that checks only correctness is incomplete.

## What this is

Lucero is building a provider-agnostic **signing and evidence core**. A client
product supplies a pre-built PDF and a set of precondition rules; the core gates
it, seals it, runs a signature ceremony through a provider, ingests the signed
artefact and assembles a verifiable evidence bundle. The first client product is
vehicle-loan origination for Argentine dealerships — a *pagaré con garantía
prendaria*. The provider is Lakaut, an Argentine certifying authority. A second,
different signing product is expected, which is why the core is a set of
packages and not an app.

The architecture is argued in `docs/research/RESULT-001-core-signing-evidence.md`.
Read §1 (verdict), §2 (the core) and §3 (constraints) before touching anything
under `packages/`; most non-obvious decisions in the code trace back there. The
`ADDENDUM` records what the vendor changed after it was written; RESULT-001
itself is never edited.

## Layout

```
apps/                      deployable products (empty; see apps/README.md)
packages/core/             contracts + error classes. Zero dependencies.
packages/gate/             PolicyGate engine, InMemoryPolicyRegistry, rule factories
packages/rules-pagare-ar/  the Argentine pagaré rule set
docs/research/             RESULT-001 (architecture investigation) + ADDENDUM (rc.40 drift)
docs/planning/             BACKLOG-001 — 28 tickets, each filed as a GitHub issue
docs/design/               one design document per non-trivial ticket
docs/vendor/lakaut/        21 mirrored Lakaut doc pages + llms.txt, pinned at SDK rc.40
docs/vendor/prototipo/     the product design prototype and a brief distilled from it
scripts/verify.sh          the one command that must pass on a laptop and in the cloud
```

`apps/` vs `packages/` is **deployable vs importable**, not shared vs
product-specific. `rules-pagare-ar` serves one product and still lives in
`packages/` because it is a library another pagaré product can import. See
`apps/README.md` before creating either.

Dependency direction is strict: `core` imports nothing; `gate` imports `core`;
`rules-pagare-ar` imports both; apps import packages; nothing in `packages/`
imports `apps/`. When the Lakaut adapter lands it will be the only package that
imports `@lakaut/*`, reached through the `SignatureProvider` port (STYLES §2).

## Commands

Root scripts, each delegating to Turborepo (`turbo.json`):

```bash
pnpm install --frozen-lockfile
pnpm build       # tsc per package → dist/
pnpm typecheck   # tsc --noEmit over src/ and test/
pnpm test        # vitest run, per package
pnpm verify      # scripts/verify.sh: install + build + typecheck + test
```

Filter to one package: `pnpm test --filter=@autopen/gate`. Bypass the Turbo
cache when you distrust it: `pnpm turbo run test --force`.

Gotchas:

- Workspace packages resolve each other through `dist/` (`exports` points at
  built output). `typecheck` and `test` declare `dependsOn: ["^build"]`, so the
  root commands build dependencies first — but running `vitest` directly inside
  a package after editing a *dependency's* source tests stale code. Run from
  the root.
- There is no linter or formatter. Style is by hand and by review; STYLES §1.2
  says what to match.
- Node 22 (`.nvmrc`, `engines`) and pnpm 10.11.1 (`packageManager`, via
  Corepack) are pinned to the Claude Code cloud image. Do not bump them
  casually; `pnpm verify` green in both places is the compatibility check.

## TypeScript

`tsconfig.base.json` is `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax` and `isolatedModules`, on
ESM `NodeNext`. Three consequences you will hit immediately: relative imports
carry `.js`; type imports must say `import type`; an optional property cannot be
assigned `undefined` unless its type says `| undefined`. STYLES §2 and §4.

## The vendor

Lakaut's SDK is `@lakaut/server` + `@lakaut/browser` at exact `0.1.0-rc.40`.
Neither is installed yet; installing needs `LAKAUT_NPM_AUTH` in a gitignored
`.npmrc`. `docs/vendor/lakaut/` is a faithful mirror of the vendor docs at rc.40
and is the citation source for every vendor claim — quote it, do not paraphrase
from memory. The vendor's seven non-negotiable rules
(`sdk-integracion__agentes.md`) are restated with their consequences in STYLES
§8–§9.

### Blocked on credentials

We have no Lakaut sandbox or dashboard credentials. Until they exist:

- CORE-23, the multi-party signature spike, cannot run. CORE-24, CORE-25 and
  CORE-26 are blocked behind it.
- The 18-item sandbox verification list in RESULT-001 §6 is unrun.
- Nothing in Track C (adapter) or Track D (borrower surface) can be tested
  against a live session.

Production URLs and credentials are `TBD` on the vendor's side as well. Tracks A
and B (instrument, evidence) depend on nothing Lakaut can change; start there.

## Environment

No environment variables are read today. When they arrive: `.env*` is gitignored
except `.env.example`; `.npmrc` is gitignored; `.claude/settings.json` denies
reading both. Never copy their contents into a log, a fixture, or a chat.

## Design documents

A non-trivial ticket gets a design document in `docs/design/` before code; the
directory's README says what one contains. Decisions that a ticket in
BACKLOG-001 already made do not need re-deciding — cite the ticket.
