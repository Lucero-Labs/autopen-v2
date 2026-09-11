# The signing spine

`seal → openCeremony → ingest → reconcile`, and the Lakaut adapter behind them.

Written **after** the code, from the installed SDK's own type declarations at
`0.1.0-rc.40`. An earlier version of this document was written from the vendored
prose, was corrected three times by contact with the real thing, and was closed
(PR #44). This one records what the port turned out to need.

## 1 · What the types changed

Reading `@lakaut/server` and `@lakaut/shared-contracts` moved five things. Each
was a claim this repository held before today.

**The delivered artefact is not "some bytes".** `SignedDocumentArtifact`
requires `sessionId`, `documentId`, `fileName`, both hashes and `signedAt`. A
port shaped `verifyArtifact(documentId, bytes, custody)` — which is what #44
proposed — cannot construct one. `SignedDelivery` in `@autopen/core` carries
exactly those fields, and they are universal to signed-PDF flows rather than
Lakaut-specific: a signed document is identified by its ceremony, its document
and two distinct hashes, and dropping any of them makes the cross-check against
the provider's record impossible.

**The SDK ships the error map.** STYLES §9.3 describes a three-way
classification with `retry-in-step` as the default for an unknown code.
`categoryFor` in `@lakaut/shared-contracts` *is* that map, `SdkErrorCategory` is
exactly those three values, and its documented default is already the safe one —
its comment cites the same 2026-08-10 `CERTIFICATE_NOT_AVAILABLE` incident the
vendor docs describe. The adapter delegates instead of reimplementing.

This changes what exhaustiveness means. There is no union of server error codes
to switch over: `AUTH_ERROR_CODES` is `readonly string[]`. What can drift is a
*category*, so the guard is a `Record<SdkErrorCategory, CeremonyDisposition>`
that stops compiling the day the vendor adds a fourth.

**The SDK ships a webhook challenge responder.** `constructWebhookChallengeResponse`
exists. The vendored documentation shows only a hand-rolled `node:crypto`
example and never mentions it. PR #51 built the hand-rolled version; closing it
was right, though not for the reason given at the time.

**Two error-code spaces, not one.** `LakautSdkErrorCode` in
`lifecycle-events.d.ts` is a proper union of 34 browser lifecycle codes.
`AUTH_ERROR_CODES` is an unenumerated server list. STYLES §9.3's "exhaustive over
`LakautSdkErrorCode`" therefore describes the browser lane only.

**`userReference` travels in webhook events.** `WebhookEventEnvelope` declares it
alongside `sessionId`, and `AuthoritativeSessionStatus.externalUserRef` is
non-optional. Issue #34's Q13 — whether `auth.session.*` events carry the
correlation key — is answered in the affirmative by the types, with the
authoritative read as a fallback when the optional field is absent.

Three more things exist that no document in this repo mentions: a `1.3.0`
webhook contract with PAdES B-T timestamp evidence (the ADDENDUM knows only
1.1 and 1.2); `signedArtifactCompletion: "delivery" | "verified_binding"`, where
the second mode makes `onDocumentSigned` resolve only after backend custody; and
a whole incremental-PDF preflight surface for signature preservation.

## 2 · Decisions

### 2.1 `documentId` is derived, which makes Q4 moot

Issue #34's Q4 asks whether `documentId` is unique per session or per
integrator, because `SIGN_DOCUMENT_CONFLICT` is terminal. **The test it
prescribes cannot be run.** `documentId` is not a `createSession` parameter — it
reaches Lakaut only inside a `HostedUiDocument`, through the browser. And the
document status endpoint answers `404 FORBIDDEN` identically for an unknown
session and an unknown document, so the keying is not observable either. Both
verified against preproduction.

So `seal` makes the question not matter:

```
documentId = SHA-256(reference "\n" SHA-256(bytes))
```

Correct under either answer. The same reference and bytes always give the same
id, so a retry is idempotent rather than a conflict; any change to either gives a
different id, so reusing an id across differing content is unrepresentable rather
than merely forbidden (§0.3, STYLES §9.2). `reference` is the caller's own
instrument identifier, in the digest so that two instruments whose bytes happen
to coincide do not collide on one id.

The question is still worth asking Lakaut. It no longer blocks anything.

### 2.2 A ceremony is a session

`ceremonyId` is the Lakaut `sessionId`. A second identifier the provider has
never heard of buys nothing, and a webhook arrives carrying `sessionId`, so
routing by it is required regardless.

### 2.3 `CeremonyState` has no `signed`

A session's lifecycle and a document's are different facts.
`AuthoritativeSessionStatus.status` of `completed` means the session closed, and
mapping that to "signed" is precisely the conflation STYLES §9.1 exists to
prevent. The states are `open | completed | cancelled | expired | failed`;
whether a document is signed is a separate authoritative read.

### 2.4 Custody crosses the port

`verifyAndAcknowledgeSignedArtifact` takes a `custody` callback and invokes it
between verifying and binding. The sink is therefore a parameter of
`SignatureProvider.verifyArtifact`, passed straight through. Archiving after
`ingest` returns would be too late; letting the adapter archive would put the
evidence store inside the vendor package (STYLES §9.5, §2).

The type declaration corrects the vendored example on one point: the callback's
first argument is the `SignedDocumentArtifact` that went in, not a transformed
"verifiedArtifact" as the doc's parameter name suggests. Evidence arrives as the
second argument.

### 2.5 Persistence is ports, with in-memory implementations

`DocumentStore` and `CeremonyLedger`, mirroring `PolicyRegistry` /
`InMemoryPolicyRegistry` in `@autopen/gate`. `core` keeps zero dependencies; a
durable store is the deploying application's problem. The ledger carries
`hasApplied` / `markApplied` because webhooks repeat and session idempotency
cannot be delegated to the provider (STYLES §9.6).

### 2.6 `identitySubject` is optional, and the decision stays open

`SignerRole.identity` is optional. Supplied, the adapter maps `nationalId → dni`
and sends `identitySubject`; absent, the field is omitted entirely. Whether to
require it — and therefore whether a DNI lives in `core` and the debtor's form
grows a registral `sexo` field — is a product decision this design does not make.

The catalogue probe adds evidence without settling it:
`requiresServerBoundIdentity` is `true` only for `auth.sms.v1`, and contracted
onboarding is `auth.email-sms.v1`, where it is `false`.

### 2.7 Hashing is WebCrypto off `globalThis`

`core` compiles against `ES2023` with no DOM or Node library, so `crypto.subtle`
and `TextEncoder` are read structurally off `globalThis` and their absence
throws `HashUnavailableError`. That keeps `core` dependency-free and
runtime-agnostic, and keeps its tests free of runtime globals (STYLES §1.1, §10).

## 3 · What fails closed

- `seal` refuses bytes with no `%PDF-` header, bytes over the provider's own
  `SIGNED_DOCUMENT_MAX_PDF_BYTES`, and an empty reference.
- `seal` refuses a stored document whose hash disagrees with its key. A caller
  cannot cause this; it means the store is corrupt.
- `openCeremony` refuses a document that was never sealed, without calling the
  provider.
- `ingest` refuses a delivery whose document was never sealed or whose ceremony
  the ledger never recorded.
- A custody sink that rejects fails the whole ingest as `CustodyFailedError`
  with the original as `cause`. Nothing is bound and nothing is archived.
- An unrecognised provider code is `retry-in-step`, by the SDK's own default.
- The adapter throws if the SDK ever returns a binding without having run
  custody.

## 4 · What is not here

`draft`, `attach`, `derive` and `assemble` — operations 1, 7, 8 and 9 of
RESULT-001 §2.2. `gate` (2) already exists in `@autopen/gate` and is untouched.

Webhook ingress. `reconcile` reads authoritative status today; consuming a
verified webhook needs a deployed endpoint, and `constructWebhookEvent` accepts
`secret: string | readonly string[]`, which is undocumented rotation support
worth using when it lands.

No live provider call is made by any test. The adapter is driven through
`LakautSessions`, a `Pick` of the three `SessionClient` methods the spine uses,
so a fixture imitates the whole surface (STYLES §10).
