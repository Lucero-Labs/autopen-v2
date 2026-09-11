# AGENTS.md

Guidance for AI coding agents, and for humans new to the repo. It is paired with
[`STYLES.md`](STYLES.md): this file covers what to know about the *repo*
(commands, layout, architecture, the vendor situation); `STYLES.md` covers how
to *write code* here (naming, types, errors, money, secrets, tests, process).

> **Read `STYLES.md` before editing any file.** If your harness loaded this file
> but not that one, open it now. Its rules bind automated reviewers as much as
> authors: a review that checks only correctness is incomplete.

## What this is

A **signing and evidence core**. A caller supplies a pre-built PDF and a set of
precondition rules; the core gates the document, seals it, runs a signature
ceremony through Lakaut — an Argentine certifying authority, and the only
provider — ingests the signed artefact and assembles a verifiable evidence
bundle. The first document is an Argentine *pagaré*; its rule set is
`packages/rules-pagare-ar`.

**Direction.** The core is expected to be consumed as an API by more than one
product. Lakaut has no tenant dimension — one `integratorId`, one webhook URL per
environment, and no tenant field in any event (RESULT-001 §3.4) — so
multi-tenancy is entirely ours. Two consequences to design around rather than
discover: every consumer's browser origin must be declared in our single Lakaut
dashboard, and every webhook for every consumer arrives at one endpoint, routed
by `sessionId` against our own records. Contracted scope is per-integration, so
every consumer shares the one above.

The architecture is argued in `docs/research/RESULT-001-core-signing-evidence.md`.
Read §1 (verdict), §2 (the core) and §3 (constraints) before touching anything
under `packages/`; most non-obvious decisions in the code trace back there. The
`ADDENDUM` records what has changed since — vendor drift and product scope;
RESULT-001 itself is never edited.

## Layout

```
apps/                      deployable products (empty; see apps/README.md)
packages/core/             contracts + error classes. Zero dependencies.
packages/gate/             PolicyGate engine, InMemoryPolicyRegistry, rule factories
packages/rules-pagare-ar/  the Argentine pagaré rule set
docs/research/             RESULT-001 (architecture investigation) + ADDENDUM (what changed since)
docs/design/               one design document per non-trivial change
docs/vendor/lakaut/        21 mirrored Lakaut doc pages + llms.txt, pinned at SDK rc.40
docs/product/              the current design prototype and a brief distilled from it
docs/vendor/prototipo/     the 2026-08-16 prototype, superseded; cited by RESULT-001
scripts/verify.sh          the one command that must pass on a laptop and in the cloud
```

`apps/` vs `packages/` is **deployable vs importable**: an app has a process, a
package does not. See `apps/README.md` before creating either.

Dependency direction is strict: `core` imports nothing; `gate` imports `core`;
`rules-pagare-ar` imports both; apps import packages; nothing in `packages/`
imports `apps/`. When the Lakaut adapter lands it will be the only package that
imports `@lakaut/*`, behind the `SignatureProvider` port, so everything else is
tested without a live call (STYLES §2, §10).

## Commands

Root scripts, each delegating to Turborepo (`turbo.json`):

```bash
pnpm install --frozen-lockfile
pnpm check       # biome: format + lint, report only
pnpm check:fix   # biome: apply what it can fix
pnpm build       # tsc per package → dist/
pnpm typecheck   # tsc --noEmit over src/ and test/
pnpm test        # vitest run, per package
pnpm verify      # scripts/verify.sh: install + check + build + typecheck + test
```

Filter to one package: `pnpm test --filter=@autopen/gate`. Bypass the Turbo
cache when you distrust it: `pnpm turbo run test --force`.

Gotchas:

- Workspace packages resolve each other through `dist/` (`exports` points at
  built output). `typecheck` and `test` declare `dependsOn: ["^build"]`, so the
  root commands build dependencies first — but running `vitest` directly inside
  a package after editing a *dependency's* source tests stale code. Run from
  the root.
- Biome (`biome.json`, pinned exact) is the formatter and linter, and runs
  inside `pnpm verify` before the build — it needs no `dist/` and finishes in
  milliseconds. It enforces the mechanical half of STYLES §1.2 plus the rules
  that are checkable: no `any`, no `!`, no default exports, `import type`,
  kebab-case filenames. The rest of STYLES is still by hand and by review.
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

### Vendor access

Preproduction is live since 2026-09-11 — integration `lucerosa`, environment
`sandbox`, origin `https://dev.lucerolabs.xyz` declared. Contracted scope is
`Onboarding` and `Onboarding + Firma` with `auth.email-sms.v1` only, and `Firma`
with all three profiles. Production URLs and credentials are still `TBD` on the
vendor's side.

This unblocks the 18-item verification list in RESULT-001 §6 and the adapter.
The multi-party signature question that used to gate several of them was settled
affirmatively by rc.40 (`ADDENDUM` §1) and is no longer open.

**Preproduction is not a scratch environment.** A Lakaut account is one per DNI,
the signing PIN is per-signature with no documented reset, and
`SIGN_PIN_RATE_LIMITED` is a real code. A test identity whose PIN locks may not
be replaceable by the same person.

Whether a synthetic DNI passes is the unresolved part, and the mirror argues both
ways. The testing checklist closes with *«Usá usuarios y documentos sintéticos o
autorizados para pruebas»* (`sdk-integracion__ambientes-versionado.md`). But
`ONBOARDING` runs identity validation with Veriff and data validation against
RENAPER as steps 4 and 5, and *«si DNI y sexo fueron proporcionados por el
backend, el paso de captura se omite, pero la validación de identidad y RENAPER
se realiza igualmente»* (`sdk-integracion__flujos-identidad.md`). Either
preproduction stubs both providers, or *«sintéticos»* covers the documents and
*«autorizados»* covers the people. Ask before assuming; the readings differ by
whether every test signer has to be a consenting human.

Treat onboarding a test subject as possibly unrepeatable, and run PIN-bearing
experiments last. `sessions.getSigningEligibility({ externalUserRef, email })` is
the one probe that costs nothing: no session, no PIN, no certificate, and it
answers whether an identity already holds one.

### Channel drift, measured 2026-09-11

Both credentials are verified working. `scripts/probe-catalog.mjs` returns the
catalogue over the API key; `scripts/probe-registry.mjs` reads the registry with
the Nexus credential. Run them rather than assuming — neither creates a session,
allocates a document, or touches an identity.

What the registry actually serves, identically for all three packages:

| Channel | Resolves to |
| --- | --- |
| `@preprod` | `0.1.0-rc.34` |
| `@dev` | `0.1.0-rc.53` |

`0.1.0-rc.40` is published and installs cleanly by exact version — verified, not
assumed. But **no channel points at it**, so the dashboard's
`pnpm add @lakaut/server@preprod` shortcut installs rc.34: six versions behind
this mirror, and the version RESULT-001 was originally written against. Pinning
the exact version is what keeps the `[Documented:]` citations valid, which
STYLES §1.1 requires regardless.

Worth asking Lakaut, because the two halves of their own preproduction disagree:
the rc.40 documentation describes itself as the preproduction-validated
candidate, while the preproduction channel serves rc.34. Until that is answered,
treat the rc.40 capability claims in `ADDENDUM` §1 as describing a version that
is installable but not necessarily the one Lakaut runs in preproduction.

`npm view` against this Nexus exits 0 and prints nothing — a silence that reads
like a missing package and is not one. The probe queries the registry over HTTP
for that reason.

## Environment

No code reads an environment variable yet. Two templates describe what will be
read, and both are checked in because neither holds a value:

- `.env.example` — the six `LAKAUT_*` variables, each with the constraint that
  makes it dangerous to get wrong. Copy to `.env`.
- `.npmrc.example` — routes the `@lakaut` scope to the private registry and
  takes the Nexus credential from `LAKAUT_NPM_AUTH`. Copy to `.npmrc`.

`.env*` is gitignored except `.env.example`; `.npmrc` is gitignored;
`.claude/settings.json` denies reading both. Never copy their contents into a
log, a fixture, or a chat.

The two credentials load by different mechanisms, and the difference is not
cosmetic. The runtime variables are read by a Node process, so `.env` reaches
them — Node 22 loads it natively with `--env-file=.env`, which is why there is
no `dotenv` dependency and should not be one. `LAKAUT_NPM_AUTH` is read by
`.npmrc`, which `pnpm` consults before any process of ours exists, and **pnpm
does not read `.env`**. Putting it there fails silently: the same
`Failed to replace env in config` warning, then a 401. It belongs in the shell
environment, or in CI as a repository secret.

Unset, it costs two warnings per install and nothing else — `@lakaut/*` is not a
dependency of any package yet, so every other install path still resolves. That
stops being true the day the adapter lands, and CI needs the credential from
that day. Only that one: STYLES §10 forbids live `@lakaut` calls in unit tests,
so CI installs with the Nexus credential and never holds the API key.

Both credentials are shown exactly once and Lakaut keeps only a hash. Rotation
is immediate with no grace period, so a rotation is a deploy, not a chore.

## Design documents

A non-trivial change gets a design document in `docs/design/` before code; the
directory's README says what one contains. A decision its issue already made
does not need re-deciding — cite the issue.
