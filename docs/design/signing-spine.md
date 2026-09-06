# The signing spine

Bytes in, verified signed artefact out — the operations a client product extends
to get a document signed, and the seam the provider sits behind.

## 1 · What this asks for

`README.md` states the boundary: given a pre-built PDF and a set of precondition
rules, the core gates, seals, runs a ceremony, ingests and assembles evidence.
`@autopen/gate` exists. Nothing else does.

RESULT-001 §2.2 already enumerates the operations, §2.4 the extension points a
second signing product supplies, §3.10 what is universal versus Lakaut-shaped,
and the `ADDENDUM` §1 what rc.40 settled. This document turns those into types.

Scope is the spine — **seal → openCeremony → ingest → reconcile** — and the
`SignatureProvider` port. Evidence assembly is a second document (§6).

## 2 · Decisions

### 2.1 The core does not render

RESULT-001 §2.2 op 1 makes `draft(templateRef, params) → Instrument` a core
operation owning "template version pinning, deterministic rendering". The
boundary in `README.md` and in the product puts a **pre-built PDF** at the
entrance, and §2.4 already lists the instrument template as an *extension point*
— "a versioned renderer producing canonical bytes", supplied by the product.

Resolved in favour of the boundary: `draft` leaves the core's operation list. The
product renders; the core's entry is `seal(bytes, templateRef)`.

What op 1's determinism requirement survives as: the core hashes what it is
handed and pins the `templateRef` that produced it, so a re-render that differs
by a byte is *detectable* (STYLES §7.2) even though the renderer is not ours.
Owning the hash is what matters; owning the renderer is not.

### 2.2 One sealed document is the unit

RESULT-001 §2.6 argued the real unit is an ordered **instrument package**, on the
evidence that an origination needs pagaré + prenda form + consumer disclosure.
The 2026-09-05 design removed the prenda and dropped *integración de consumo*, so
both documents that motivated the package are gone and the product signs one PDF.

Design for one sealed document. `Instrument` holds a list rather than a single
field, so a package is an extension and not a rewrite, but no ordering or
packaging machinery is built. Cheap to allow, expensive to retrofit; costly to
build for a case that no longer has an example.

### 2.3 The provider port is three methods

Per §2.4 and §3.10: `openCeremony`, `authoritativeStatus`, `verifyArtifact`.
Everything on §3.10's Lakaut-specific list — RENAPER, `flowType`, `journeyId`,
`identitySubject`, PIN semantics, the error taxonomy, `toRendererContext`, the
810 px iframe, the HMAC scheme — lives behind it. `@lakaut/*` appears in the
adapter package and nowhere else (STYLES §2).

### 2.4 The core does not model national identity

`identitySubject { dni, sexo }` is Lakaut-shaped, is on the never-log list
(STYLES §8.1) and must never reach the browser (§8.2). Rather than carry it and
guard it everywhere, the core carries an opaque product-supplied reference and
the adapter resolves it. A DNI that is never in `core` cannot leak from `core`.

*Cost, stated plainly:* the core cannot answer "who signed this" on its own — it
holds a reference and a certificate fingerprint. Evidence assembly resolves the
reference through the product. That is the right trade while identity is
jurisdiction-specific (§2.6: generalise to "identity assurance with named method
and evidence", not to RENAPER).

### 2.5 One ceremony, one signer; only the backend closes it

One-signer-per-session is a Lakaut constraint (§3.1, §3.2) and rc.40 did not
change it. What rc.40 *did* change is that sequential ceremonies over one PDF
preserve prior signatures (`ADDENDUM` §1), so multi-signer is orchestration in
our core rather than a provider feature — and the current design needs one
signer anyway.

`reconcile` is the only path to a terminal state, and it reads authoritative
status or a verified webhook. A browser event moves the UI and nothing else
(STYLES §0.2, §9.1). `ingest` treats delivered bytes as a copy to verify, never
as proof.

### 2.6 Failures are classified by the adapter, never by code in the core

The port surfaces a `disposition`, not a provider code. The three-way split and
the unknown-code default live in the adapter (STYLES §9.3), so the core never
learns Lakaut's taxonomy and a provider swap does not touch it.

## 3 · Types

```ts
export type InstrumentId = string & { readonly __brand: "InstrumentId" };
export type DocumentId = string & { readonly __brand: "DocumentId" };
export type CeremonyId = string & { readonly __brand: "CeremonyId" };

export interface TemplateRef {
  readonly id: string;
  readonly version: string;
}

export interface ContentHash {
  readonly algorithm: "sha-256";
  readonly value: string; // lowercase hex
}

/** Frozen bytes and an identity the core will never re-issue for other content. */
export interface SealedDocument {
  readonly documentId: DocumentId;
  readonly contentHash: ContentHash;
  readonly bytes: Uint8Array;
  readonly templateRef: TemplateRef;
  readonly sealedAt: string; // ISO-8601, from the injected Clock
}

export type AssuranceLevel = "advanced" | "qualified";

/** `subject` is opaque to the core; the adapter resolves it (§2.4). */
export interface SignerRole {
  readonly role: string; // product vocabulary — "suscriptor"
  readonly assurance: AssuranceLevel;
  readonly subject: { readonly ref: string };
}

/** Produced only by the adapter. Never hand-built (STYLES §8.2). */
export type ProviderRendererContext = {
  readonly __brand: "ProviderRendererContext";
};

export type CeremonyHandle =
  | { readonly kind: "hosted-url"; readonly url: string }
  | { readonly kind: "embedded"; readonly context: ProviderRendererContext };

export interface Ceremony {
  readonly ceremonyId: CeremonyId;
  readonly documentId: DocumentId;
  readonly role: SignerRole["role"];
  readonly handle: CeremonyHandle;
  readonly openedAt: string;
}

export type FailureDisposition = "retry-in-step" | "terminal" | "session-recovery";

export interface ProviderFailure {
  readonly disposition: FailureDisposition;
  readonly code: string; // the provider's, kept for support
  readonly correlationId?: string;
}

export type CeremonyStatus =
  | { readonly state: "pending" }
  | { readonly state: "signed"; readonly signedAt: string }
  | { readonly state: "failed"; readonly failure: ProviderFailure }
  | { readonly state: "abandoned"; readonly at: string };

/** PAdES levels as the standard defines them; rc.40 produces only B-B and B-T. */
export type SignatureProfile =
  | "PAdES-B-B"
  | "PAdES-B-T"
  | "PAdES-B-LT"
  | "PAdES-B-LTA";

export interface SignatureAttestation {
  readonly signerCertificateFingerprint: string;
  readonly signingTime: string;
  readonly profile: SignatureProfile;
}

export interface VerifiedArtifact {
  readonly documentId: DocumentId;
  readonly contentHash: ContentHash; // of the signed bytes, not the sealed ones
  readonly bytes: Uint8Array;
  readonly signatures: readonly SignatureAttestation[];
  readonly verifiedAt: string;
}

/** The only seam a provider sits behind. Implemented once, in the adapter. */
export interface SignatureProvider {
  openCeremony(document: SealedDocument, role: SignerRole): Promise<Ceremony>;
  authoritativeStatus(ceremonyId: CeremonyId): Promise<CeremonyStatus>;
  verifyArtifact(documentId: DocumentId, bytes: Uint8Array): Promise<VerifiedArtifact>;
}

/** What a client product drives. Takes the port as a parameter (STYLES §2). */
export interface SigningCore {
  seal(bytes: Uint8Array, templateRef: TemplateRef): Promise<SealedDocument>;
  openCeremony(document: SealedDocument, role: SignerRole): Promise<Ceremony>;
  ingest(documentId: DocumentId, bytes: Uint8Array): Promise<VerifiedArtifact>;
  reconcile(ceremonyId: CeremonyId): Promise<CeremonyStatus>;
}
```

`SignatureProvider`, its types and `SigningCore` live in `@autopen/core`, which
keeps zero dependencies. The adapter implements the port; nothing else imports
`@lakaut/*`.

## 4 · What fails closed

- `seal` rejects bytes without a `%PDF-` header or over the provider's 20 MB
  limit, and throws `SealConflictError` when a `documentId` is already sealed
  against a different `contentHash` — the local mirror of
  `SIGN_DOCUMENT_CONFLICT`, which is terminal (STYLES §9.2). A correction is a
  new instrument, never an edit.
- A `SealedDocument` is frozen and no code path mutates it.
- `ingest` that cannot verify returns a custody failure and archives nothing. It
  never falls back to trusting the delivered bytes.
- `reconcile` is idempotent on the webhook envelope's `idempotencyKey`. An event
  for an unknown ceremony is persisted and alerted, never dropped (STYLES §0.1).
- An unrecognised provider code is `retry-in-step` (STYLES §9.3) — the one place
  the permissive direction is correct, because escalating costs the whole flow.
- `signed_document_delivery_failed` means the document **is signed**. Reconcile;
  never re-sign.

## 5 · How it is tested

- **Seal is deterministic and conflict-safe:** identical bytes hash identically
  across two runs (STYLES §7.2); re-sealing a `documentId` with different bytes
  throws.
- **A browser event closes nothing:** feeding a `flow.completed`-shaped input
  leaves the ceremony `pending` until `reconcile` reads authoritative status.
  This is the test that protects §0.2, and it is the one most likely to be
  quietly deleted later.
- **Webhook idempotency:** the same envelope twice produces one transition.
- **Custody failure archives nothing.**
- Recorded fixtures only; no live `@lakaut/*` calls (STYLES §10).

## 6 · Out of scope

- **Evidence: `attach`, `derive`, `assemble`** — a second design document. The
  2026-09-05 design specifies six bundle items and a liquidación, which is
  enough to write it, but it is a different change.
- **The Lakaut adapter.** Blocked on credentials; this document defines the port
  it will implement so the shape is settled before the sandbox exists.
- **Rendering**, which is the product's (§2.1).
- **Multi-signer orchestration.** Viable per `ADDENDUM` §1, unnecessary for a
  design with one suscriptor. The role graph stays an extension point.
