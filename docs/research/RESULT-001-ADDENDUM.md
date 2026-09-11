# RESULT-001 · Addendum

**Dated 2026-09-05.** Accompanies `RESULT-001-core-signing-evidence.md`
(PR #1), which was written against the vendor documentation as it stood on
2026-08-16.

RESULT-001 is **not edited**. It records what was knowable on the day it was
written and why we concluded what we did; rewriting it to look correct in
hindsight would destroy that trail. This file records what moved underneath it:
§1–§7 the vendor's drift from rc.34 to rc.40, §8 the product scope.

## How the vendor drift was established

The mirror in `docs/vendor/lakaut/` was re-fetched through the identical
pipeline used on 2026-08-16 — same page list, same `<article>` extraction, same
pandoc invocation, same cleanup pass — so every difference is vendor content
drift rather than conversion noise. 15 of 22 files changed. The re-mirrored
files land in the same commit as this addendum, so `git show` on that commit is
a readable diff of what the vendor changed.

The SDK pin moved from `0.1.0-rc.34` to `0.1.0-rc.40`.

---

## 1. The existential question resolved itself, affirmatively

§3.1 named multi-party signing "the single largest risk in the investigation",
turning on whether a second ceremony over an already-signed PDF preserves the
first signature. RESULT-001 marked it **[Unknown]** and read the evidence as
leaning the wrong way: two distinct hashes implied the service rewrites the file
after signing, which is the pattern that destroys a prior signature's byte
range.

rc.40 adds a section, *Capacidades criptográficas actuales*, stating capabilities
as verifiable for the preproduction-validated candidate:

| Capability | Vendor's stated status |
| --- | --- |
| Actualización incremental | **Soportada** — assembles a single incremental revision |
| Preservación de firmas previas | **Soportada**, validated against a real chain of prior signatures |
| PAdES B-B | Supported |
| PAdES B-T | Supported when the RFC 3161 timestamp is valid |
| PAdES B-LT / B-LTA | **Not supported** |
| TSA / RFC 3161 | **Supported** in preproduction; the integrator does not configure the TSA |
| LTV material | **Not supported** |

[Documented: `[firma]` §"Capacidades criptográficas actuales"]

**Consequence.** Sequential ceremonies over one PDF are viable. The
countersignature design is no longer forced. §3.1's consequences 1 and 2 —
ceremony-as-orchestration and `PARTIALLY_SIGNED` as a first-class state — still
hold; they follow from one-signer-per-session, which has not changed.

**Two caveats.** The claim is scoped to rc.40 *validated for preproduction* and
says explicitly that it does not accredit production. And the absence of
B-LT/B-LTA and LTV material remains a genuine gap for an instrument that may be
enforced years after signing.

## 2. Timestamping is answered

§3.9 recorded **[Unknown]** on whether any trusted timestamp exists, and
recommended applying our own RFC-3161 timestamp at ingest. A TSA now exists and
the integrator does not configure it.

**Consequence.** CORE-10 should be re-evaluated rather than assumed. The
argument for our own timestamp is now the narrower one: no LTV material means
nothing captures certificate validity for later verification, so independently
timestamping and capturing revocation state at ingest may still be worth doing —
but as an LTV measure, not because no timestamp exists.

## 3. Certificate-state lookup now exists

§3.5 and open question 7 asked whether a holder's certificate state could be
checked before creating a session, and concluded it could not: "No la
encontramos en `getCatalog()` ni en los seis métodos de `SessionClient`."

rc.40 adds `SessionClient.getSigningEligibility({ externalUserRef, email })` and
`POST /v1/sdk/signing-eligibility`, returning `READY_FOR_SIGNING`,
`ONBOARDING_REQUIRED`, `CERTIFICATE_PREPARING` or `RETRY_LATER`. A `SIGNING`
session against an expired or revoked certificate produces
`CERTIFICATE_REQUIRED` after authentication — it does not silently fall back to
onboarding. [Documented: `[agentes]`, `[sesiones]` §"Saber si el titular puede
firmar"]

**Consequence.** CORE-26 unblocks. Open questions 7 and 8 are answered.

## 4. A second webhook contract changes the ingest design

§3.9 concluded that Lakaut returns no PDF bytes through any channel, making
*ingest-verify-archive* mandatory and the browser copy the only path. That
premise is now optional rather than forced.

rc.40 adds an opt-in capability declared at session creation —
`capabilities: ["signed-document-reconciliation:1.2"]` — and a composite
operation:

```ts
await sessions.verifyAndAcknowledgeSignedArtifact({
  artifact,
  idempotencyKey: `${artifact.sessionId}:${artifact.documentId}:custody`,
  correlationId,
  custody: async (verifiedArtifact, evidence) => { /* durable custody here */ },
});
```

The callback must complete durable custody *before* the binding is registered.
An exact replay returns the original binding; the same identifiers with
different hashes conflict; a failure never authorises another signature. Only
once `BOUND` does `auth.document.signed` upgrade from `1.1.0` to `1.2.0` and
carry both `signedContentHash` and `finalPdfHash`, plus `artifactBindingStatus`
and `bindingId`. New endpoint:
`POST /v1/sdk/sessions/{sessionId}/documents/{documentId}/signed-artifact-binding`.

The two contracts are never both emitted for one signature, there is no backfill
for earlier receipts, and a receiver must accept both during migration.
[Documented: `[firma]` §"Custodia y binding 1.2"; `[eventos]` §"Constancia de
documento firmado 1.1 y 1.2"]

**Consequence.** CORE-08, CORE-09 and CORE-11 change scope. `verifySignedPdfArtifact`
still exists as the low-level path for controlling verification and custody
separately, so the port shape survives — but the default implementation should be
the 1.2 lane.

## 5. Breaking and additive changes

- **`integratorId` is the canonical UUID**, shown under *Empresa / contrato*. The
  slug is now only a label and does not substitute for it. Anything wired to a
  slug breaks. `LAKAUT_INTEGRATOR_ID` is explicitly not secret, but is
  environment-bound. [Documented: `[ambientes]`, `[agentes]`]
- **`visibleSignaturePlacement`** is a new session field on `SIGNING` and
  `ONBOARDING_AND_SIGNING`: 1-based `page` defaulting to the last, integer
  coordinates normalised 0–1000 with origin at the visible `CropBox` top-left
  after 0/90/180/270 rotation, positioning the stamp's top-left corner. A
  versioned preset `lakaut-default-bottom-right@1` exists. Invalid geometry
  returns `INVALID_VISIBLE_SIGNATURE_PLACEMENT` before the PIN and before
  signing — no clamping, no page substitution, no silent movement.
  [Documented: `[firma]` §"Posición visible de la firma"]
- **One new error code**, `INVALID_VISIBLE_SIGNATURE_PLACEMENT`. The taxonomy
  goes from 42 codes to 43. CORE-18's table needs it. No codes were removed and
  no code changed category.
- **Webhook verification tightened**: `Lakaut-Event-Timestamp` must now equal the
  `t=` value in `Lakaut-Signature`. The HMAC construction and the 300-second
  tolerance are unchanged. [Documented: `[eventos]`]

## 6. What did not move

- **Persona jurídica: still absent.** Zero occurrences across all 21 pages,
  before and after. §3.1 consequence 3 and open question 5 stand exactly as
  written: the *firma del acreedor* has no documented path, and choosing among
  the three fallbacks remains a legal determination nobody has made. **This is
  now the largest open risk in the investigation.**
- **Production is still `TBD`** — same sentence, unchanged: "Las URLs,
  credenciales y registro de producción son `TBD`."
- **Origins and tenancy**: §3.3 stands. Per-session `allowedOrigin` is still one
  concrete origin, dashboard wildcards still fail on save, and multi-tenancy is
  still entirely ours.

## 7. Effect on the open questions

Of the 27 questions in §5, these are answered by rc.40 and should be removed
before sending: **7, 8** (eligibility lookup), **14, 15** (TSA). Questions
**1–3** are answered on paper by the capability table but are worth one
confirming sandbox run rather than deletion. Question **4** — `documentId`
uniqueness per session or per integrator — is unaffected and still blocks.

Everything else stands, and question **5** is now the one with the longest lead
time and the most downstream design behind it.

## 8. Product scope has narrowed

RESULT-001 §1 and §2.1 frame the core around a first client product — a
loan-origination flow for one industry, signing a secured pagaré — and expect a
second, different signing product to follow. That framing is no longer current.
The core is built for a document; the first is an Argentine pagaré
(`packages/rules-pagare-ar`). Lakaut is the provider; no second provider or
product is planned, which is what §1 and §7 already advised.

Nothing in §2 or §3 changes: the operations, the constraints and the sandbox
list are about signing a PDF and holding evidence of it, not about what the PDF
says. `README.md` is the live description.

BACKLOG-001, which broke the core into 28 `CORE-NN` tickets, was retired with
this change; all 28 issues were closed as not planned on 2026-08-19 and the
document was deleted. `CORE-NN` references elsewhere in this addendum name
tickets that no longer exist — they are kept because this file is a dated
record. Open GitHub issues are the live plan.

---

## 9. §3.6's email claim is wrong, and §5's risk 5 with it

RESULT-001 §3.6 concludes *"Onboarding therefore requires an email address"* and
§5 lists it as risk 5: *"Either the origination form grows a validated email
field, or first-time borrowers cannot be onboarded."* Both overstate the source.

**What the vendor actually says.** `[sesiones]` §"Campos de la sesión" lists
`allowedOrigin` as *"el único campo estrictamente obligatorio"*, `email` as
*"No — salvo con `auth.sms.v1`… Email inicial; Hosted UI lo utiliza sin
exponerlo en eventos"*, and `phone` as *"Prellenado de conveniencia, igual que
`email`"*.

The error is a conflation. `requiredInputs: ["EMAIL", "PHONE"]` names what the
**journey** collects, inside the Hosted UI. It is not what the **integrator**
must supply. §3.6 says as much two paragraphs earlier — pre-supplying `email`
*"suppresses the capture step but not the verification"* — which only makes
sense if there is a capture step to suppress. Onboarding a signer who has never
given us an address works; Lakaut asks them for one.

**Confirmed against the live integration.** The preproduction scope panel for
integration `lucerosa` (2026-09-11) shows `Onboarding` and `Onboarding + Firma`
with one method, `Email + SMS`, and `Firma` with three — `Email + SMS`,
`Sólo email`, `Sólo SMS`. That is the profile matrix §3.6 describes, and it
constrains which profile is legal, not which field the integrator sends.

**What survives, in a narrower and more useful form.** Holding the email is not
required to onboard. It is required for two specific things:

1. `getSigningEligibility` — the call that routes a returning signer to `SIGNING`
   rather than `ONBOARDING_AND_SIGNING` — takes `email: string` as a
   non-optional field of `SigningEligibilityInput` [`[api]`
   §`getSigningEligibility`].
2. `auth.sms.v1` *"exige `email` y `phone` juntos"* server-bound, and the SDK
   fails before the call leaves our process when either is missing
   [`[sesiones]`]. The Sólo SMS convenience is unavailable without both.

And the email does not come back to us on its own: *"Los payloads no contienen
OTP, DNI, email, PIN, token, evidencia biométrica ni PDF"* [`[eventos]`]. An
address Lakaut collects inside the iframe is one we never learn.

**Consequence.** Not a blocking origination field, and not a design change to
the borrower's first screen. It is a choice: hold the email and get cheap
routing plus SMS-only for repeat signers, or do not and re-derive the journey
some other way each time. Risk 5's severity drops from *High* to *Low*, and it
changes category from "missing field" to "routing strategy".

**Open, and cheap to settle now that preproduction access exists.** Whether
creating `ONBOARDING_AND_SIGNING` for a signer who already holds a valid
certificate is a no-op or re-runs onboarding. If it is a no-op, the email is
never needed for routing at all. The documentation does not say; the sandbox
will.
