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
bundle. Products live elsewhere: the pagaré app is its own repository and
calls `apps/signing-service` over HTTP.

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
apps/                      deployable products; see apps/README.md
packages/core/             contracts + error classes + the signing spine. Zero dependencies.
packages/gate/             PolicyGate engine, InMemoryPolicyRegistry, rule factories
packages/adapter-lakaut/   the Lakaut provider. The only package importing @lakaut/*
packages/tsconfig/         compiler settings every package extends; see its README
docs/research/             RESULT-001 (architecture investigation) + dated addenda (what changed since)
docs/vendor/lakaut/        21 mirrored Lakaut doc pages + llms.txt, pinned at SDK rc.40
scripts/verify.sh          the one command that must pass on a laptop and in the cloud
scripts/check-docs.mjs     the checkable half of STYLES §5
lefthook.yml               git hooks: format on commit, check on push
```

`apps/` vs `packages/` is **deployable vs importable**: an app has a process, a
package does not. See `apps/README.md` before creating either.

Dependency direction is strict: `core` imports nothing; `gate` imports `core`;
`adapter-lakaut` imports `core` and `@lakaut/*`
and is the only package that may; apps import packages; nothing in `packages/`
imports `apps/`. The adapter sits behind the `SignatureProvider` port, so
everything else is tested without a live call (STYLES §2, §10).

## Commands

Root scripts, each delegating to Turborepo (`turbo.json`):

```bash
pnpm install --frozen-lockfile
pnpm check       # biome: format + lint, report only
pnpm check:fix   # biome: apply what it can fix
pnpm check:docs  # exported declarations carry JSDoc; TODOs cite an issue
pnpm build       # tsc per package → dist/
pnpm typecheck   # tsc --noEmit over src/ and test/
pnpm test        # vitest run, per package
pnpm verify      # scripts/verify.sh: install + check + docs + build + typecheck + test
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
  kebab-case filenames. `pnpm check:docs` adds the checkable half of §5. The
  rest of STYLES is still by hand and by review.
- `pnpm install` wires git hooks through lefthook (`lefthook.yml`): Biome
  formats and re-stages staged files on commit, and `check:ci` plus
  `check:docs` run on push. They are a convenience in front of CI, not a
  replacement — `--no-verify` skips them and CI does not. `LEFTHOOK=0` skips
  them once.
- Node 22 (`.nvmrc`, `engines`) and pnpm 10.11.1 (`packageManager`, via
  Corepack) are pinned to the Claude Code cloud image. Do not bump them
  casually; `pnpm verify` green in both places is the compatibility check.

## TypeScript

`packages/tsconfig/base.json` is `strict` plus `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax` and `isolatedModules`, on
ESM `NodeNext`. Three consequences you will hit immediately: relative imports
carry `.ts`, rewritten to `.js` on emit; type imports must say `import type`; an
optional property cannot be assigned `undefined` unless its type says
`| undefined`. STYLES §2 and §4.

A package's `tsconfig.json` is one line — `{ "extends":
"@autopen/tsconfig/library.json" }` — and its `tsconfig.typecheck.json` extends
`typecheck.json`. The shared files write paths as `${configDir}/…`, so they
resolve against the package, not against `packages/tsconfig/`.

## The vendor

Lakaut's SDK is `@lakaut/server` + `@lakaut/browser` at exact `0.1.0-rc.40`,
installed by `packages/adapter-lakaut` alone; installing needs `LAKAUT_NPM_AUTH`
in a gitignored `.npmrc`. `docs/vendor/lakaut/` is a faithful mirror of the
vendor docs at rc.40 and is the citation source for every vendor claim — quote it, do not paraphrase
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

**Preproduction is not a scratch environment.** The signing PIN is per
signature with no documented reset, `SIGN_PIN_RATE_LIMITED` is a real code, and
an identity whose PIN locks may not be recoverable. Write the PIN down when you
set one.

**An account is one per email, not one per DNI** — measured 2026-09-21, when the
same person onboarded a third time under a new address and received a new
certificate (`docs/research/ADDENDUM-quota.md`). So a test signer is any mailbox
you control; what you cannot fake is the person. `ONBOARDING` runs a live
biometric check (the widget is branded *FID by Lakaut*; the docs say Veriff) and
it rejects a bad capture, so *«usuarios sintéticos»*
(`sdk-integracion__ambientes-versionado.md`) does not extend to the identity
step: every onboarding needs a consenting human in front of a camera, three
attempts allowed. Lakaut has not offered a synthetic-identity path when asked.

Run PIN-bearing experiments last.
`sessions.getSigningEligibility({ externalUserRef, email })` is the one probe
that costs nothing: no session, no PIN, no certificate, and it answers whether
an identity already holds one.

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

**The service is not stale — only the tag is.** Probed the same day by asking
two rc.40-only endpoints to reject an empty body:
`POST /v1/sdk/signing-eligibility` and the artefact-binding route both answer
`400 INVALID_REQUEST`, not `404`. A route that does not exist answers before it
inspects a body, so both are present. The rc.40 capability claims in `ADDENDUM`
§1–§4 therefore describe endpoints preproduction actually serves.

That narrows the discrepancy to packaging: the `@preprod` tag lags the service
it is meant to install against. Still worth mentioning to Lakaut, but it is not
a reason to distrust the mirror. A 400 proves a route exists; it does not prove
every rc.40 behaviour behind it, so a capability that matters should still be
exercised rather than assumed.

`npm view` against this Nexus exits 0 and prints nothing — a silence that reads
like a missing package and is not one. The probe queries the registry over HTTP
for that reason.

## Environment

Only apps read the environment, and each validates it once at import:
`apps/signing-service/src/env.ts` is the pattern (zod through `@t3-oss/env-core`),
reporting a variable's name and never its value. Packages take configuration
as arguments and never read `process.env` (`adapter-lakaut/src/client.ts`).
Two templates describe what is read, and both are checked in because neither
holds a value:

- `.env.example` — the six `LAKAUT_*` variables, each with the constraint that
  makes it dangerous to get wrong, and the service's own four (`PORT`,
  `EVIDENCE_DIR`, `AUTOPEN_API_KEY`, `DATABASE_URL`), which `env.ts` — still
  the only reader — validates the same way. Copy to `.env`.
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
