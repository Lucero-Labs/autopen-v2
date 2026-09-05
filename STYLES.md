# STYLES.md

How code is written in this repository. [`AGENTS.md`](AGENTS.md) says what the
repo is; this says how to work in it. Sections are numbered so reviews and
design documents can cite them: "§6.2" means the same thing to everyone.

**Scope.** Every file, every PR, every review — by a human or by an automated
reviewer. Claude Code, Claude Review and any other bot reviewing this repo must
apply every rule here and flag deviations even when the change is otherwise
correct. A review that checks only correctness is incomplete.

---

## 0. Foundational principles

When two approaches both work, these decide. They override personal preference.

1. **Fail closed.** What cannot be determined is not assumed. No registered
   policy → throw. A rule throws → the whole evaluation fails. A webhook for an
   unknown session → persist and alert, never drop.
2. **The backend is authoritative.** Browser events move the UI. Only the
   provider's API or a verified webhook closes an operation.
3. **Irreversible things are unrepresentable-if-illegal.** Sealed bytes cannot
   be edited by any code path; a wrong transition is an error, not a convention.
4. **Consistency over preference.** Code doing the same job in two places looks
   the same in both. Change a pattern in one file, propagate it to its siblings.
5. **Explicit over implicit.** `=== undefined`, not truthiness. Named options,
   not positional booleans. Spelled-out types on exported signatures.
6. **The smallest diff is not always the right diff.** Review-fix commits are
   the highest-risk moment for drift: the quickest fix drops a helper next to
   its one consumer when §1.2 puts it with its siblings, or patches a symptom in
   `gate` that belongs in `core`. When writing or delegating a fix, say where
   the code goes, not only what it does.
7. **Source cites this repo only.** A comment may point at `RESULT-001 §3.9` or
   the prototype's S1 — those live in `docs/`. It never says "like casia does",
   "previously this used X" or "per the Notion doc"; that goes in the PR.

## 1. Files and structure

### 1.1 Packages

- One directory per package under `packages/`, named `@autopen/<dir>`,
  `"private": true`, `"type": "module"`, `exports` pointing at `dist/`. Copy
  `packages/gate/package.json` and change the name; do not invent a variant.
- `src/` for source, `test/` for tests; `dist/` is generated and gitignored. A
  `README.md` when the package has decisions worth explaining — `gate` has one.
- Workspace dependencies are `"workspace:*"`. External dependencies are exact
  versions: no `^`, no `~`, no `latest`, no git URLs. A vendor rule for
  `@lakaut/*`, ours for everything else. `@lakaut/server` and `@lakaut/browser`
  are additionally the same version in every package.
- `core` has zero dependencies and stays that way. Code that needs a library
  does not belong in `core`.

### 1.2 Files

- kebab-case filenames: `policy-gate.ts`.
- Order inside a file: module doc comment (when the module has a stance —
  `contracts.ts`, `draft.ts`), imports, module constants, types, non-exported
  helpers, exported declarations. A helper used by one export may sit directly
  below it; a helper used by two sits above both.
- Two-space indent, double quotes, semicolons, trailing commas, 100 columns.
  Biome enforces all five (`biome.json`); `pnpm check:fix` applies them. Import
  order (§2) is not mechanised — Biome's organiser also alphabetises a barrel's
  named exports, which would scramble `core/src/index.ts` out of the reading
  order its contracts follow. That one stays a review rule.
- `index.ts` is a barrel and nothing else: `export { … } from` and
  `export type { … } from`, no logic. Export what a consumer needs and no more.

## 2. Imports and modules

- ESM under `NodeNext`: relative imports carry `.js` (`from "./contracts.js"`)
  even though the file on disk is `.ts`.
- `verbatimModuleSyntax` is on: `import type { … }`, or an inline `type`
  modifier when a statement mixes values and types (`policy-gate.ts` does).
- Cross-package imports use the package name (`from "@autopen/core"`), never a
  relative path into another package's `src/`.
- Named exports only. No default exports.
- Order: external packages, then `@autopen/*`, then relative, blank-line
  separated.
- Dependency direction is enforced by review until a tool does it: `packages/`
  never imports `apps/`; `core` imports nothing; `@lakaut/*` appears only inside
  the adapter package, behind the `SignatureProvider` port. Anything else that
  needs the provider takes the port as a parameter.

## 3. Naming

### 3.1 Identifiers

- Standard TypeScript casing: camelCase functions and values, PascalCase types,
  SCREAMING_SNAKE for a frozen module constant (`PAGARE_AR_KEY`). Rule
  factories are nouns (`required`, `onlyWhen`); everything else verb-first.
- Error classes are `<Problem>Error` extending `CoreError`. Generic parameters
  are `T<Role>` (`TSubject`). Booleans read as a verdict: `isPresent`,
  `issuable`, `satisfied`.
- Rule ids are `<jurisdiction>.<instrument>.<kebab-name>`
  (`ar.pagare.lugar-de-pago-requerido`); policy ids are
  `<jurisdiction>.<instrument>.v<N>` (`ar.pagare.v1`). Both are written into
  stored verdicts, so renaming one is a data migration, not a refactor.

### 3.2 Spanish stays Spanish

Argentine legal terms are Spanish wherever they appear — identifiers, rule ids,
messages, docs: `pagaré`, `prenda`, `lugarDePago`, `integracionDeConsumo`,
`primerVencimiento`, `cuota`, `liquidación`, `constancia`, `persona física /
jurídica`. They are terms of art with no English equivalent an Argentine lawyer
would recognise; a half-translated codebase (`paymentPlace`) is one where nobody
can find anything.

- Identifiers are ASCII: `integracionDeConsumo`, not `integraciónDeConsumo`.
  Accents live in strings, comments and prose.
- A concept with an exact, universally recognised English equivalent may be
  English — `debtor`, `nationalId`, `instrument` — but pick one word per
  concept and keep it. `rules-pagare-ar` says `debtor`; do not add `deudor`
  for the same thing elsewhere.
- Operator-facing messages are Spanish, verbatim from the product, and live
  beside the rule that emits them (`policy.ts`), not in a UI layer.
- Code structure, comments, JSDoc, commits and design docs are English.

## 4. Types

- `readonly` on every field of every exported interface; returned objects are
  `Object.freeze`d. Verdicts are stored — a mutable verdict is a falsified
  record waiting to happen.
- `interface` for object shapes, `type` for unions. Outcomes are discriminated
  unions (`RuleOutcome`), never a bag of optionals plus a boolean.
- `exactOptionalPropertyTypes` is on. *May be absent* is `?:`; *may be present
  but undefined* is `| undefined`; a field callers build from `Partial<>` needs
  both. Assemble optional fields by conditional spread —
  `...(x !== undefined ? { x } : {})`, as `rules.ts` does — never by assigning
  `undefined`.
- `noUncheckedIndexedAccess` is on. Indexing yields `T | undefined`; handle it.
  `!` is forbidden outside a test line directly after an assertion proving it.
- No `any`. Narrow `unknown` with a type guard.
- Private state uses `#fields`, not `private`.
- Inject anything non-deterministic (`Clock`, `RuleContext.now`). A rule that
  calls `new Date()` is untestable and breaks §7.2.
- Brand identifiers that are easy to confuse once they exist — `documentId`,
  `sessionId`, `instrumentId`. A plain `string` where a session id was meant is
  how a receipt gets attached to the wrong instrument.

## 5. Comments and JSDoc

- Every export has a JSDoc whose first sentence states the contract. A summary
  that restates the identifier (`/** The policy gate. */`) is review-blocking.
- A second paragraph, when present, carries the *why*: constraint, invariant,
  decision. The class comment in `policy-gate.ts` ("Two decisions worth knowing
  about") is the model.
- Inline comments explain a non-obvious choice in a line or two — `// flatMap
  rather than filter+map: the ternary narrows the union, a filter predicate
  does not.` They never restate the code.
- `TODO` only with an issue: `// TODO(#25): …`. A bare TODO is review-blocking.
- Comments and JSDoc change in the same commit as the code they describe.

## 6. Errors and fail-closed

### 6.1 Errors

- Domain errors extend `CoreError`, set `name` from `new.target.name`, and carry
  identifying data as `readonly` constructor properties
  (`PolicyNotFoundError.key`). Callers catch by class, never by message.
- Wrap, do not swallow. A rule's exception becomes `RuleEvaluationError` with
  `cause` set; the original is never lost.
- A function returning `T` throws when it cannot proceed — no `undefined`, no
  `null`, no sentinel. `T | undefined` is reserved for "not found" lookups
  (`PolicyRegistry.resolve`).

### 6.2 Fail closed

- A missing policy throws `PolicyNotFoundError`. An instrument with no
  requisites registers an explicit empty policy. Silently issuing because
  nobody configured rules is the failure this abstraction exists to prevent.
- A throwing rule fails the evaluation. `issuable: false` would be
  indistinguishable from a real finding; `true` would be dangerous.
- Issuability, custody, signature validity — anything gating an irreversible
  step — never defaults to the permissive value when its signal is missing.
- The one deliberate exception: an unrecognised provider error code is
  `retry-in-step` (§9.3), because there the harmful direction is escalation.

## 7. Money and determinism

### 7.1 Money is integer centavos

Money is an integer count of the minor unit. Never a float, never a `number`
holding a fraction, never a string parsed at the point of use. `$1.900.000` is
a presentation of `190000000` centavos, formatted at the edge with `es-AR`
conventions. A pagaré off by a centavo after 24 cuotas is a document someone
can challenge in court.

- The rounding policy for derived figures (cuota, costo total, intereses) is
  written down once and applied everywhere. CORE-01 owns it.
- Arithmetic on money goes through the money type. `amount * rate` on raw
  numbers is review-blocking wherever the result is money.

### 7.2 Determinism where a hash is taken

Anything whose output is hashed — rendered PDFs, evidence manifests — produces
byte-identical output for identical inputs, across runs and machines: no
embedded timestamps, no non-deterministic font subsetting, no locale drift, no
iteration over unordered collections. Otherwise the content hash means nothing
and the seal (§9.2) is theatre. Time enters through an injected clock, never
`Date.now()` inside the thing being hashed. A renderer or manifest test asserts
byte equality across two runs.

## 8. Secrets and logging

### 8.1 Never log

The vendor's list, plus the webhook secret: API key, `clientToken`, OTP, DNI,
sexo, PIN, PDF bytes, biometric evidence, JWTs. Not at `debug`, not in a test
fixture, not in an error message, not pasted into a chat with an agent. This is
a vendor hard rule (`sdk-integracion__agentes.md`, "Reglas que no se
negocian"), not a preference. CORE-28 adds a test that these cannot reach a
sink.

Safe, and required on every line that touches a ceremony: `environment`,
`integratorId`, `sessionId`, `documentId`, `correlationId`, `errorCode`,
timestamp. `correlationId` is the only handle vendor support can trace.

### 8.2 Secrets

- The API key never leaves the backend — not in a bundle, not in an API
  response, not in a client log.
- The browser receives exactly `toRendererContext()`, never a hand-built
  object. `identitySubject` and `continuationFromSessionId` must not reach it.
- Secrets come from the environment or a secrets manager. `.env*` and `.npmrc`
  are gitignored and `.claude/settings.json` denies reading them.

## 9. Vendor invariants

From Lakaut's documentation as mirrored in `docs/vendor/lakaut/` at rc.40, and
from RESULT-001. Each is here because its failure mode looks like success.

### 9.1 The backend is authoritative

`lakaut.flow.completed` means "the visual experience ended". It is the cue to
show a success screen, not the fact that a document is signed. Browser events
can be lost, duplicated, or arrive before the persisted transition. Nothing
irreversible — marking signed, completing a session, exporting evidence —
happens until confirmed against `getSession` / `getSignedDocumentStatus` or a
verified webhook.

- `onDocumentSigned` delivers bytes from an untrusted client: a copy to be
  verified, not proof.
- `signed_document_delivery_failed` means the document **is already signed**.
  Never re-sign; reconcile from the backend.
- Webhooks repeat. Handling is idempotent on the envelope's `idempotencyKey`.
  Verification runs `constructWebhookEvent` over the raw body — parsing and
  re-serialising breaks the HMAC — and is never hand-rolled.

### 9.2 Sealed is immutable

Once bytes are sealed and a `documentId` allocated, that pairing is permanent.
`SIGN_DOCUMENT_CONFLICT` — "ese `documentId` ya se firmó con otro contenido" —
is terminal. A correction is a *new* instrument that supersedes the old one,
never an edit. A code path that mutates a sealed instrument is a bug even when
no test catches it.

### 9.3 Unknown error codes are `retry-in-step`

Provider error codes map to `retry-in-step`, `terminal` or `session-recovery`.
A code not in the map is `retry-in-step`. Escalating instead recreates the
session and makes the signer redo OTP, identity and certificate — the vendor
documents a real incident at another integrator caused by exactly this
(`sdk-integracion__errores.md`, `CERTIFICATE_NOT_AVAILABLE`). Wrong in the safe
direction costs one retry; wrong the other way costs the whole flow.

- Decide by code, never by HTTP status; the same code arrives with different
  statuses from different endpoints.
- Retry within the step keeps session, document and step, clears only the PIN,
  and prevents double submission.
- The map is exhaustive over `LakautSdkErrorCode`; a test fails when the SDK
  adds a code (CORE-18).

### 9.4 Explicit profiles

Sessions always send `authenticationProfileId` explicitly — the default resolves
differently for `flowType` and `journeyId`. `getCatalog()` is asserted at boot
rather than hardcoding journey/profile combinations (CORE-14).

## 10. Testing

- vitest, in `test/*.test.ts`, named for the module or surface under test and
  mirroring `src/` names (`policy-gate.test.ts`, `policy.test.ts`).
- `describe` names the unit or behaviour; `it` is a sentence that reads as a
  claim: `it("throws rather than guessing when no policy is registered")`.
  `it("works")` or an assertion-free test is review-blocking.
- Test through the public surface. `rules-pagare-ar` runs the real `PolicyGate`
  over the real policy, not the rule functions in isolation.
- Assert operator-facing message text, not only that a finding exists. The
  message is the product; a test that passes when it changes protects nothing.
- Keep runtime-agnostic packages runtime-agnostic in tests: `await
  Promise.resolve()` to prove an await, not a timer that drags Node types into
  `core`.
- No live `@lakaut/*` calls in unit tests. The adapter is tested against
  recorded fixtures; live behaviour belongs to the sandbox list (RESULT-001 §6).

### 10.1 Legal rules need a named human

Nothing in `rules-pagare-ar` — a new rule, a changed message, a severity change
— ships because tests pass. A wrong precondition produces a document that looks
correct and is unenforceable, and no test catches that. The PR names the person
who reviewed the legal content and bumps the policy `version`, so a stored
verdict stays explicable after the rules change.

## 11. Commits, branches, PRs

- Branch: `<type>/<short-description>`, lowercase, hyphens — `feat/core-gate`,
  `docs/lakaut-rc40-drift`.
- Commit subject: conventional prefix with scope, lowercase, imperative —
  `feat(gate): …`, `docs(vendor): …`. The body says *why*, in prose; the diff
  already says what. Commits made with Claude Code end with the
  `Co-Authored-By` and `Claude-Session` trailers.
- PR description: the decision and its reasoning, what was verified and how.
  References to the prototype or to anything outside this repo go here (§0.7).
- Nothing under `packages/` merges without `pnpm verify` green. Nothing in
  `rules-pagare-ar` merges without §10.1.

## 12. Pre-finish checklist

Before opening or updating a PR:

1. `pnpm verify` passes from the root — install, check, build, typecheck, test.
2. Every new export has a contract JSDoc; every new field is `readonly`; every
   returned object is frozen (§4, §5).
3. No `any`, no `!`, no `Date.now()` in gated or hashed code, no money as a
   `number` with a fraction (§4, §7).
4. Grep the diff for the never-log list, including test fixtures (§8.1).
5. Dependency direction holds: no `apps/` import in `packages/`, no `@lakaut/*`
   outside the adapter (§2).
6. Spanish terms are Spanish, ASCII in identifiers, one word per concept (§3.2).
7. If `rules-pagare-ar` changed: policy `version` bumped, legal reviewer named
   in the PR (§10.1).
8. A design decision no ticket already made is written in `docs/design/`.
9. Comments and JSDoc moved with the code, and the fix went where §1.2 puts it,
   not where the diff was smallest (§0.6).
