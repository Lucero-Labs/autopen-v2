# The signing service

The core deployed once, behind an HTTP API and a hosted signing page, so that
more than one product can sign documents without holding the vendor
credential, installing the vendor SDK, or being reachable by the vendor.

## 1 · What it asks for

Written before the code. There is no issue yet; this document is the proposal.
A first draft was frame-checked on 2026-09-24 and this version records what
that changed (§7).

RESULT-001 §2 defines the core as operations a product drives in-process, and
§3.4 records the constraint that makes that hard to share: Lakaut has one
`integratorId`, one webhook URL and one secret per environment, no tenant field
in any event, and every browser origin that mounts a ceremony must be declared
in the one dashboard. `docs/building-on-autopen.md` lists the same facts as
"what every product shares". The 2026-09-21 preproduction run added a fourth:
`@lakaut/*` comes from a private registry that a product built outside this
repository cannot install from.

The pagaré product needs a backend: an issuer creates an instrument and sends
the signer a link, which RESULT-001 §3.3 already recommends as one declared
origin with the instrument in the link. The core was always meant to be
consumed through a generic interface (AGENTS.md, "Direction"). And a second
product is wanted, by a co-founder who will build his own prototypes outside
this repository and should be able to serve himself without anyone here
building them for him. That reverses `RESULT-001-ADDENDUM` §8 ("no second
provider or product is planned"), and it does so before that product has been
described: what it signs, who signs, who pays, at what volume. So this document
designs the pagaré product's backend as a generic service and keeps exactly one
seam for a second consumer, rather than designing an API around a consumer
nobody can yet describe. Each of the four shared facts is a reason the core
cannot be a library for that consumer, and one change removes all four: **run
the core as one service that owns the vendor integration end to end, and hand
products a URL.**

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

### 2.3 Products authenticate with an API key we issue, and spend a budget we count

One key per product (`consumerId`), random, shown once, stored as a hash,
sent as a bearer token. Rotation is "issue a second, revoke the first"; a
revoked key fails closed immediately. The key is a backend credential: a
product that sends it from a browser has published it, and the docs for
consumers say so in those words.

This is our key, not Lakaut's. Lakaut's API key lives in the service's
environment and nowhere else (STYLES §8.2). How a product authenticates *its
own* users — Google sign-in for a pagaré issuer, whatever the second product
chooses — is the product's, and the service never sees it.

Every consumer draws on the one signature balance, which Lakaut allocates to
the integration (`ADDENDUM-quota`, resolved 2026-09-14), which no API can read,
and whose exhaustion is terminal and looks to the signer like a wrong PIN. So a
consumer's experiments can make another consumer's real signer fail, and the
service is the only place that can stop it. Each consumer has a **signature
budget**, an integer we set and count down when a ceremony is opened; at zero
the service refuses to open one before Lakaut is touched. The count is ours and
conservative — a failed attempt is assumed to have cost a credit until Lakaut
says otherwise — because the harmful direction is opening one too many.

### 2.4 The service decides the journey

A product supplies the signer's email and phone. The service runs the
cost-free eligibility probe itself and picks `signing` or
`onboarding-and-signing`, so a product never learns the concept. The demo made
the caller choose; that was right for a demo exercising both journeys and
wrong for an API.

### 2.5 The gate stays in the signing path, selected by an explicit `policyId`

RESULT-001 §2 has the core gate the document before it is sealed, and §7 calls
the gate the part that is ours alone. Rules are code and cannot travel over
HTTP, but they do not need to: the service holds the registered rule sets and a
product names one. `POST /v1/instruments` carries a `policyId` and a `subject`;
the service resolves the policy, parses the subject with that policy's own
parser, evaluates, and seals only on `issuable: true`. Findings come back to
the caller with the operator-facing messages the rule set wrote (STYLES §3.2)
and nothing is sealed.

`policyId` is mandatory and one of its values is the explicit `none`, which is
STYLES §6.2's empty policy: a caller that wants no gate says so, and a caller
that names nothing gets `400`, not a signature. An unknown id is a refusal, not
a fallback. The first draft of this document put gating in each product; that
was reversed because the consumer least able to hold a precondition rule
correctly is exactly the one being designed for.

The pagaré product sends `ar.pagare.v1` with its `PagareDraft`. A second
product sends `none` until its rule set exists as a package here, at which
point it is registered like any other. Rule sets stay packages — the service
imports them, it does not define them — so `rules-pagare-ar` remains the one
place a pagaré rule lives and STYLES §10.1 still applies to it.

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

### 2.7 Inbound events are routed by `sessionId`; products poll

The Lakaut webhook route is the demo's, unchanged in verification: raw body,
SDK helper, idempotency on the envelope key, persist, then act. What is new is
routing: the ledger already maps `sessionId` to a ceremony; the ceremony now
carries `consumerId` and `instrumentId`, so an event finds its product.

A product learns of a signature by polling `GET /v1/instruments/{id}`, which
answers `signed` only after `ingest` returned and never on a browser event
(STYLES §9.1). An outbound webhook to the product is deferred (§7): Lakaut's
inbound webhook cannot be verified today, so polling is the only confirmation
path that exists, and building an event system on top of one we cannot yet
receive would be building on the part that is broken.

## 3 · Surface

```ts
// The unit the service manages. One product, one reference, one sealed
// document, the ceremonies opened over it, and at most one verified artefact.
interface Instrument {
  readonly instrumentId: InstrumentId;
  readonly consumerId: ConsumerId;
  readonly reference: string;              // the product's own id, namespaced by consumerId
  readonly policyId: PolicyKey | "none";   // what gated it; stored with the verdict
  readonly documentId: DocumentId;         // from `seal`, only after `issuable: true`
  readonly signer: { readonly email: string; readonly phone?: string };
  readonly state: "awaiting-signature" | "signed" | "cancelled" | "expired";
  readonly ceremonyIds: readonly CeremonyId[];
  readonly artifact?: { readonly certificateRef: string; readonly signedAt: string; … };
}
```

| Route | Auth | Does |
| --- | --- | --- |
| `POST /v1/instruments` | API key | Gates the `subject` under `policyId`, then seals the PDF (`reference`, bytes, signer). Returns `instrumentId`, `signingUrl`, `state`, or `422` with the findings and nothing sealed. Idempotent on (`consumerId`, `reference`, content hash). Refused at budget zero. |
| `GET /v1/instruments/{id}` | API key | The instrument, from the service's own records plus `reconcile` when a ceremony is open. |
| `GET /v1/instruments/{id}/artifact` | API key | The signed PDF, once `signed`. |
| `GET /sign/{token}` | none | The hosted page. Creates or resumes the ceremony on first open. |
| `POST /api/deliveries` | page | The demo's `ingest` route, keyed by the page's token, not by the product's key. |
| `POST /api/webhooks/lakaut` | HMAC | The demo's inbound route, plus routing. |

`SigningCore` is unchanged. The service is a thin owner of `Instrument` around
it: gate then `seal` at create, `openCeremony` at first page open, `ingest` at
delivery, `reconcile` on read and on inbound event. The only pagaré-specific
import is the registration of `rules-pagare-ar` under its key, beside `none`:

```ts
// One registry entry per rule set the service can be asked for. `parse` is the
// rule set's own, so the service never knows a subject's shape.
interface RegisteredPolicy {
  readonly key: PolicyKey | "none";
  readonly parse: (subject: unknown) => TSubject;   // throws → 400, nothing evaluated
  readonly gate: PolicyGate<TSubject>;
}
```

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
- **No `policyId`, or an unregistered one** → `400`, nothing evaluated,
  nothing sealed. **A subject the policy's parser rejects** → `400`. **A rule
  that throws** → the evaluation fails and so does the request (STYLES §6.2),
  never `issuable: false` and never a seal.
- **Budget at zero** → `409` before any call to Lakaut. The count is ours; when
  in doubt it has been spent.

## 5 · How it is tested

- **Routes** run against a fake `SignatureProvider` and in-memory stores: no
  live `@lakaut/*` call (STYLES §10). Each row of the table above has a test
  per outcome in §4.
- **The gate in the path**: `ar.pagare.v1` with a draft missing `lugarDePago`
  returns `422` carrying the rule set's own Spanish message and no document is
  stored; `none` seals; a missing or unknown `policyId` seals nothing.
- **The budget**: the last credit opens a ceremony, the next request is refused
  and the fake provider records no call.
- **Postgres stores** run against a real Postgres, a service container in CI.
  Asserted: `put` is write-once and the same id with different content
  rejects; `hasApplied` survives a restart; the custody sink's commit is
  observable before the fake provider is asked to bind.
- **Never-log** (§8.1): a full create → open → deliver → signed flow with
  stdout and stderr captured; asserted absent are the API key, the page
  token, the handoff, the PDF bytes and the signer's email. Present are
  `sessionId`, `documentId`, `correlationId`.
- **Eligibility, journeys, PIN behaviour** stay on the live list (RESULT-001
  §6), measured by hand, not in CI.

## 6 · Out of scope

- Rendering and the evidence bundle (`draft`, `assemble`): a product sends a
  finished PDF and keeps the `VerifiedArtifact` it is given.
- More than one signer per instrument. The model allows N ceremonies; v1
  exposes one.
- Embedding the hosted page in a product's page (§2.2).
- Object storage for artefacts; a self-service console for API keys; rate
  limiting beyond one key and one budget per product.
- Production Lakaut credentials, still `TBD` on the vendor's side.
- The pagaré product's own app — issuer sign-in, the create form, the send
  step — which is a consumer of this service and a separate design.

## 7 · Deferred, and what must be true first

The 2026-09-24 frame-check (recorded in the PR that introduced this document)
split the first draft. What stayed is the pagaré product's backend with one
seam, `consumerId`, kept the way RESULT-001 §3.3 kept the tenant-origin seam:
a column, one value, no machinery. What moved here waits on answers that are
not engineering's to give.

**Deferred from the design**

- An outbound webhook to products, HMAC-signed by us with our own idempotency
  key and retry. Waits on Lakaut's inbound webhook being verifiable at all,
  which it is not today (`ADDENDUM-quota`, resolved 2026-09-21).
- A consumer-facing API document beyond `docs/building-on-autopen.md`, and any
  self-service issuance of keys or budgets. One consumer is configured by hand.
- A second rule set in the registry. `none` is what a second product gets
  until its rules exist as a package under STYLES §10.1.

**What must be true before the seam becomes a second consumer**

1. That product is described in one paragraph by the person building it: what
   document it signs, who signs it, who pays, roughly how many signatures a
   month, and why it is not a screen inside the pagaré product. Until then it
   gets a key against staging, a budget, and the existing surface.
2. Lakaut has answered, in writing: whether one integration may serve
   signatures for a product we do not operate; whether the balance is pooled
   per integration in production as it is in preproduction; what a production
   signature costs; and when production credentials arrive. The first answer
   can end the second consumer outright; the second decides whether §2.3's
   budget is a courtesy or a necessity.

**What decides the build after this one, and is not this document's**

- Whether art. 101 inc. g) covers a non-bank lender, and whether a firma
  digital pagaré under Ley 25.506 has been executed in an Argentine court. The
  lawyer answers; the answer moves the pagaré product, not this service.
- Whether a lender pays for the signature or for the court-ready bundle with
  the liquidación. If the bundle, the next build is `assemble`, not more API.
