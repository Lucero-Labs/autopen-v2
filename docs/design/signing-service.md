# The signing service

The core deployed once, behind an HTTP API and a hosted signing page, so that
more than one product can sign documents without holding the vendor
credential, installing the vendor SDK, or being reachable by the vendor.

## 1 · What it asks for

Written before the code. There is no issue yet; this document is the proposal.

RESULT-001 §2 defines the core as operations a product drives in-process, and
§3.4 records the constraint that makes that hard to share: Lakaut has one
`integratorId`, one webhook URL and one secret per environment, no tenant field
in any event, and every browser origin that mounts a ceremony must be declared
in the one dashboard. `docs/building-on-autopen.md` lists the same facts as
"what every product shares". The 2026-09-21 preproduction run added a fourth:
`@lakaut/*` comes from a private registry that a product built outside this
repository cannot install from.

Two products now want to sign: the pagaré product (an issuer creates an
instrument and sends the signer a link) and a second product built outside this
repository by someone who will not run `pnpm verify`. Each of the four shared
facts is a reason the core cannot be a library for the second one, and one
change removes all four: **run the core as one service that owns the vendor
integration end to end, and hand products a URL.**

## 2 · Decisions

### 2.1 A service, not a published library

`apps/signing-service`, grown from `apps/signing-demo`, which it replaces. The
demo's six calls become routes; the demo's `web/` becomes the hosted page.

Publishing the packages was the alternative. It leaves every product holding
the API key, declaring its own origin, installing from Nexus, and unable to
receive webhooks. A product on the service holds none of those — it holds a
credential we issue and revoke, which is the only credential a product built
by vibe-coding should ever hold.

### 2.2 The service hosts the signing page; products get a link

A product never mounts the ceremony. It creates an instrument and receives a
signing URL on our origin; the signer opens it and the page mounts the Hosted
UI there. So the one declared origin per environment is ours, the handoff (a
single-use token, STYLES §8.1) never leaves the service, and the browser SDK is
installed in one place.

The URL carries an opaque token that identifies the *instrument*, not a Lakaut
session. The session is created when the signer first opens the page, not when
the instrument is created: a link is sent by email or WhatsApp and opened at
the signer's leisure, and the session lifetime is the vendor's to set, not
ours. A link opened after its instrument is settled or cancelled says so and
creates nothing.

Embedding our page inside a product's page is out of scope (§6): the Hosted UI
needs camera access, and an iframe inside an iframe is a permissions problem we
have not measured.

### 2.3 Products authenticate with an API key we issue

One key per product (`consumerId`), random, shown once, stored as a hash,
sent as a bearer token. Rotation is "issue a second, revoke the first"; a
revoked key fails closed immediately. The key is a backend credential: a
product that sends it from a browser has published it, and the docs for
consumers say so in those words.

This is our key, not Lakaut's. Lakaut's API key lives in the service's
environment and nowhere else (STYLES §8.2). How a product authenticates *its
own* users — Google sign-in for a pagaré issuer, whatever the second product
chooses — is the product's, and the service never sees it.

### 2.4 The service decides the journey

A product supplies the signer's email and phone. The service runs the
cost-free eligibility probe itself and picks `signing` or
`onboarding-and-signing`, so a product never learns the concept. The demo made
the caller choose; that was right for a demo exercising both journeys and
wrong for an API.

### 2.5 Gating stays in the product

RESULT-001 §2 has the core gate the document against a rule set the caller
supplies. Over HTTP a rule set cannot be supplied — rules are code — so the
service signs what it is given, and a product runs its own gate before calling.
The pagaré product uses `@autopen/gate` with `rules-pagare-ar` in its own
process; the second product's rules are its own. Nothing about any instrument
type reaches the service.

### 2.6 Postgres, on Railway, one deployment per Lakaut environment

`DocumentStore` and `CeremonyLedger` get Postgres implementations in
`apps/signing-service/src/store/`; they move to a package the day a second app
needs them, which is mechanical. Signed PDFs are custodied as `bytea` in the
same database, committed inside the custody sink before it resolves, so the
custody-before-binding order (STYLES §9.5) is one transaction commit and not a
convention. Object storage is a later change (§6); documents are bounded by
`LAKAUT_MAX_DOCUMENT_BYTES`, so the table stays small.

Lakaut's one-webhook-URL-per-environment maps exactly onto two deployments:
staging carries the `sandbox` credentials and webhook secret, production the
production ones. A stable public URL per deployment also retires the tunnel
for the declared origin and for the webhook.

### 2.7 Inbound events are routed by `sessionId`; outbound events are ours

The Lakaut webhook route is the demo's, unchanged in verification: raw body,
SDK helper, idempotency on the envelope key, persist, then act. What is new is
routing: the ledger already maps `sessionId` to a ceremony; the ceremony now
carries `consumerId` and `instrumentId`, so an event finds its product.

A product learns of a signature two ways, both truthful and neither depending
on the browser (STYLES §9.1): polling `GET /v1/instruments/{id}`, and an
outbound webhook `instrument.signed` we sign with an HMAC over the raw body,
with our own idempotency key and retry with backoff. A product's endpoint
being down delays its notification and changes nothing else. The status
endpoint answers `signed` only after `ingest` returned, and the outbound event
is emitted from that same transition.

## 3 · Surface

```ts
// The unit the service manages. One product, one reference, one sealed
// document, the ceremonies opened over it, and at most one verified artefact.
interface Instrument {
  readonly instrumentId: InstrumentId;
  readonly consumerId: ConsumerId;
  readonly reference: string;              // the product's own id, namespaced by consumerId
  readonly documentId: DocumentId;         // from `seal`
  readonly signer: { readonly email: string; readonly phone?: string };
  readonly state: "awaiting-signature" | "signed" | "cancelled" | "expired";
  readonly ceremonyIds: readonly CeremonyId[];
  readonly artifact?: { readonly certificateRef: string; readonly signedAt: string; … };
}
```

| Route | Auth | Does |
| --- | --- | --- |
| `POST /v1/instruments` | API key | Seals the PDF (`reference`, bytes, signer). Returns `instrumentId`, `signingUrl`, `state`. Idempotent on (`consumerId`, `reference`, content hash). |
| `GET /v1/instruments/{id}` | API key | The instrument, from the service's own records plus `reconcile` when a ceremony is open. |
| `GET /v1/instruments/{id}/artifact` | API key | The signed PDF, once `signed`. |
| `GET /sign/{token}` | none | The hosted page. Creates or resumes the ceremony on first open. |
| `POST /api/deliveries` | page | The demo's `ingest` route, keyed by the page's token, not by the product's key. |
| `POST /api/webhooks/lakaut` | HMAC | The demo's inbound route, plus routing. |

`SigningCore` is unchanged. The service is a thin owner of `Instrument` around
it: `seal` at create, `openCeremony` at first page open, `ingest` at delivery,
`reconcile` on read and on inbound event. Nothing about pagarés is imported.

## 4 · What fails closed

- **No or unknown API key** → `401`, empty body. **Another product's
  instrument** → `404`, indistinguishable from a missing one.
- **Inbound event for an unknown `sessionId`** → persisted, alerted, `200`
  (RESULT-001 §3.4). Never dropped, never acted on.
- **Custody commit fails** → the sink rejects, no binding, `ingest` throws,
  the instrument stays `awaiting-signature`. The page shows a retry, not a
  receipt.
- **Outbound webhook undelivered** → retried; the product's record stays
  unmarked until `2xx`. Polling is always available and never lies.
- **Link for a settled or cancelled instrument** → the page says so; no
  session is created.
- **`LAKAUT_WEBHOOK_SECRET` unset** → the inbound route answers `503`, as the
  demo does.
- **Database unreachable at boot** → the process exits before it listens.
- **A second `POST` with the same `reference` and different bytes** → a new
  instrument, never a conflict; a corrected document is a new instrument
  (STYLES §9.2).

## 5 · How it is tested

- **Routes** run against a fake `SignatureProvider` and in-memory stores: no
  live `@lakaut/*` call (STYLES §10). Each row of the table above has a test
  per outcome in §4.
- **Postgres stores** run against a real Postgres, a service container in CI.
  Asserted: `put` is write-once and the same id with different content
  rejects; `hasApplied` survives a restart; the custody sink's commit is
  observable before the fake provider is asked to bind.
- **Never-log** (§8.1): a full create → open → deliver → signed flow with
  stdout and stderr captured; asserted absent are the API key, the page
  token, the handoff, the PDF bytes and the signer's email. Present are
  `sessionId`, `documentId`, `correlationId`.
- **Outbound signature**: a reference verifier accepts what we send and
  rejects a body altered by one byte.
- **Eligibility, journeys, PIN behaviour** stay on the live list (RESULT-001
  §6), measured by hand, not in CI.

## 6 · Out of scope

- Rendering and the evidence bundle (`draft`, `assemble`): a product sends a
  finished PDF and keeps the `VerifiedArtifact` it is given.
- The gate over HTTP (§2.5).
- More than one signer per instrument. The model allows N ceremonies; v1
  exposes one.
- Embedding the hosted page in a product's page (§2.2).
- Object storage for artefacts; a self-service console for API keys; rate
  limiting beyond one key per product.
- Production Lakaut credentials, still `TBD` on the vendor's side.
- The pagaré product's own app — issuer sign-in, the create form, the send
  step — which is a consumer of this service and a separate design.
