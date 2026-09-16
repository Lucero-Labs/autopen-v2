/**
 * The signing spine: seal → openCeremony → ingest → reconcile.
 *
 * Everything here is provider-free. The signature provider, the document store
 * and the ceremony ledger are ports; `@autopen/core` keeps zero dependencies and
 * never learns what is on the other side of them.
 *
 * Two shapes carry most of the weight. `SealedDocument` is the first
 * irreversible transition — bytes, a hash and an identity that may never be
 * paired with different content again. `CustodySink` is a parameter rather than
 * a return value because the provider invokes it *between* verifying an artefact
 * and registering the binding, and that ordering is the invariant (STYLES §9.5).
 */

/** A sealed document's stable identity. Derived from its content (see `seal`). */
export type DocumentId = string & { readonly __brand: "DocumentId" };

/** One signer's pass over one sealed document. */
export type CeremonyId = string & { readonly __brand: "CeremonyId" };

/** Lowercase hex SHA-256. Branded because a hash and an id are both strings. */
export type ContentHash = string & { readonly __brand: "ContentHash" };

/** Reads the current instant. Injected so anything hashed stays deterministic. */
export type Clock = () => Date;

/**
 * Bytes frozen against an identity, with the hash that ties them together.
 *
 * The bytes are a copy taken at seal time: a caller that keeps mutating its own
 * buffer cannot retroactively change what was sealed (§0.3).
 */
export interface SealedDocument {
  readonly documentId: DocumentId;
  readonly contentHash: ContentHash;
  readonly bytes: Uint8Array;
  readonly sealedAt: string;
}

/** Registral identity, supplied only when the caller binds the signer to it. */
export interface SignerIdentity {
  readonly nationalId: string;
  readonly sexo: "M" | "F";
}

/**
 * Who is being asked to sign.
 *
 * `identity` is optional on purpose. Binding it is what makes the provider
 * verify the signer against a specific person rather than whoever holds the
 * link — but whether to require it is a product decision, so the port supports
 * both and forces neither.
 *
 * `email` and `phone` are pre-fills for the ceremony's own forms, not stored
 * facts: Lakaut documents `phone` as *"client-side pre-fill convenience only,
 * same as email — not persisted or validated by the backend today"*
 * (`sessions.d.ts` at rc.40). Supplying one saves the signer some typing and
 * establishes nothing.
 */
export interface SignerRole {
  readonly role: string;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
  readonly identity?: SignerIdentity | undefined;
  readonly externalUserRef?: string | undefined;
}

/**
 * What a ceremony has to accomplish for its signer.
 *
 * Per ceremony rather than per deployment, because it is a fact about the
 * person: a signer who already holds a certificate needs `signing`, and one who
 * does not needs `onboarding-and-signing`. The provider itself computes this
 * per identity — Lakaut's eligibility read returns a recommended journey — so
 * fixing it at construction would put signer data in process configuration.
 */
export type CeremonyJourney = "signing" | "onboarding-and-signing";

/**
 * Which factors the signer clears before the ceremony proceeds.
 *
 * Always stated, never defaulted: a provider's own default resolves differently
 * per journey, and a silently-resolved factor set is a signer who was asked for
 * less than intended (STYLES §9.4). Which combinations a provider actually
 * allows is its business, asserted against its catalogue rather than encoded
 * here.
 */
export type AuthenticationFactors = "email" | "sms" | "email-and-sms";

/**
 * How one ceremony is to be run, decided per signer.
 *
 * Separate from `SignerRole` because it describes the ceremony, not the person:
 * the same debtor is `signing` on their second pagaré and
 * `onboarding-and-signing` on their first.
 */
export interface CeremonyPlan {
  readonly journey: CeremonyJourney;
  readonly factors: AuthenticationFactors;
}

/**
 * What the client hands to its renderer, opaque to the core.
 *
 * Provider-shaped by necessity and never logged: for Lakaut this is exactly
 * `toRendererContext()` output, which carries a single-use client credential
 * (STYLES §8.2).
 */
export interface CeremonyHandoff {
  readonly provider: string;
  readonly context: Readonly<Record<string, unknown>>;
}

/**
 * An opened ceremony: which document, and the handoff that starts it in a browser.
 *
 * `SigningCore.openCeremony` records it in the ledger before returning it, so a
 * webhook that arrives for it can always be routed. `openedAt` is when we asked, not when the signer
 * arrived.
 */
export interface Ceremony {
  readonly ceremonyId: CeremonyId;
  readonly documentId: DocumentId;
  readonly handoff: CeremonyHandoff;
  readonly openedAt: string;
}

/** What a failure means for the flow. An unknown code is `retry-in-step` (§9.3). */
export type CeremonyDisposition = "retry-in-step" | "terminal" | "session-recovery";

/**
 * A ceremony's lifecycle, which is not the same as a document's.
 *
 * `completed` says the visual experience ended and the provider's session
 * closed. It does **not** say a document is signed — that is a separate
 * authoritative read, surfaced through `ingest` (STYLES §9.1). Naming this
 * state `signed` would invite exactly the conflation the rule exists to stop.
 */
export type CeremonyState = "open" | "completed" | "cancelled" | "expired" | "failed";

/**
 * A ceremony's state as the provider's backend reports it.
 *
 * Only this closes anything. A browser event moves the UI and nothing else
 * (STYLES §9.1).
 */
export interface CeremonyStatus {
  readonly ceremonyId: CeremonyId;
  readonly state: CeremonyState;
  readonly disposition?: CeremonyDisposition | undefined;
  readonly errorCode?: string | undefined;
  readonly externalUserRef: string | null;
  readonly correlationId: string;
  readonly observedAt: string;
}

/**
 * One signature found in verified bytes, as the provider's evidence describes it.
 *
 * It identifies a certificate, not a person: RENAPER identity is established
 * only transitively, through the certificate's issuance (RESULT-001 §3.8).
 * `certificateRef` is empty when the evidence shape does not carry one.
 */
export interface SignatureAttestation {
  readonly signerCertificateFingerprint: string;
  readonly certificateRef: string;
  readonly algorithm: string;
  readonly signedAt: string;
}

/**
 * Signed bytes that verified against the provider's authoritative record.
 *
 * `signedContentHash` covers what was signed; `finalPdfHash` covers the file as
 * assembled. They differ, and conflating them is how a valid signature gets
 * attached to the wrong bytes.
 */
export interface VerifiedArtifact {
  readonly documentId: DocumentId;
  readonly signedContentHash: ContentHash;
  readonly finalPdfHash: ContentHash;
  readonly bytes: Uint8Array;
  readonly signatures: readonly SignatureAttestation[];
  readonly verifiedAt: string;
}

/**
 * Durable custody, invoked by the provider between verification and binding.
 *
 * It must resolve before the binding is registered, and rejecting must cancel
 * the binding rather than leave an artefact bound but unarchived (STYLES §9.5).
 * It crosses the port for that reason alone: archiving after `ingest` returns
 * would be too late, and letting the adapter archive would put the evidence
 * store inside the provider package.
 */
export type CustodySink = (artifact: VerifiedArtifact) => Promise<void>;

/**
 * What an untrusted client delivers when a ceremony ends.
 *
 * A copy to be verified, never proof that anything was signed (STYLES §9.1).
 * Every field here is one the provider needs in order to cross-check the copy
 * against its own record, which is why the shape is wider than "some bytes":
 * a signed PDF is identified by its ceremony, its document and two distinct
 * hashes, and dropping any of them makes the cross-check impossible.
 */
export interface SignedDelivery {
  readonly ceremonyId: CeremonyId;
  readonly documentId: DocumentId;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly signedContentHash: ContentHash;
  readonly finalPdfHash: ContentHash;
  readonly signedAt: string;
}

/** The only seam a signature provider sits behind. Implemented in the adapter. */
export interface SignatureProvider {
  openCeremony(document: SealedDocument, signer: SignerRole, plan: CeremonyPlan): Promise<Ceremony>;
  authoritativeStatus(ceremonyId: CeremonyId): Promise<CeremonyStatus>;
  verifyArtifact(delivery: SignedDelivery, custody: CustodySink): Promise<VerifiedArtifact>;
}

/**
 * Where sealed documents live.
 *
 * `put` is write-once by contract: re-sealing identical bytes is a no-op, and
 * the same id with different content is the conflict `seal` refuses (§9.2).
 */
export interface DocumentStore {
  put(document: SealedDocument): Promise<void>;
  get(documentId: DocumentId): Promise<SealedDocument | undefined>;
}

/**
 * Ceremonies and what has already been applied to them.
 *
 * `hasApplied` / `markApplied` exist because webhooks repeat: handling is
 * idempotent on the envelope's `idempotencyKey` (STYLES §9.1), and provider
 * session idempotency cannot be relied on to do it for us (§9.6).
 */
export interface CeremonyLedger {
  record(ceremony: Ceremony): Promise<void>;
  get(ceremonyId: CeremonyId): Promise<Ceremony | undefined>;
  settle(status: CeremonyStatus): Promise<void>;
  latestStatus(ceremonyId: CeremonyId): Promise<CeremonyStatus | undefined>;
  hasApplied(idempotencyKey: string): Promise<boolean>;
  markApplied(idempotencyKey: string): Promise<void>;
}

/** What a client product drives. Takes its ports as constructor parameters (§2). */
export interface SigningCore {
  seal(bytes: Uint8Array, reference: string): Promise<SealedDocument>;
  openCeremony(documentId: DocumentId, signer: SignerRole, plan: CeremonyPlan): Promise<Ceremony>;
  ingest(delivery: SignedDelivery, custody: CustodySink): Promise<VerifiedArtifact>;
  reconcile(ceremonyId: CeremonyId): Promise<CeremonyStatus>;
}
