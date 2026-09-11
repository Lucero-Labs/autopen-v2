/**
 * The Lakaut implementation of `SignatureProvider`.
 *
 * This is the only file in the repository that may import `@lakaut/*`
 * (AGENTS.md, STYLES §2). Everything provider-shaped stops here: session
 * creation, the renderer context, the error taxonomy, the 1.2 binding lane and
 * the distinction between a session's status and a document's.
 *
 * Three decisions are worth knowing about.
 *
 * A ceremony *is* a Lakaut session, so `ceremonyId` is the `sessionId`. Nothing
 * is gained by inventing a second identifier the provider has never heard of,
 * and a webhook arriving with only a `sessionId` has to route by it anyway.
 *
 * `capabilities: ["signed-document-reconciliation:1.2"]` is declared on every
 * session. It is opt-in and it is what makes custody-before-binding available;
 * omitting it would silently leave us on the 1.1 lane where an artefact is
 * acknowledged before it is archived (STYLES §9.5).
 *
 * Failure classification is delegated to the SDK's own `categoryFor`, not
 * reimplemented. The vendor ships the map, the three categories are exactly our
 * dispositions, and its default for an unknown code is already `retry-in-step` —
 * a rule that exists because a code missing from a hand-written list destroyed
 * a real signing flow at another integrator (STYLES §9.3).
 */

import type {
  Ceremony,
  CeremonyId,
  CeremonyState,
  CeremonyStatus,
  Clock,
  CustodySink,
  SealedDocument,
  SignatureProvider,
  SignedDelivery,
  SignerRole,
  VerifiedArtifact,
} from "@autopen/core";
import { type SessionClient, toRendererContext } from "@lakaut/server";
import type { SignedPdfVerificationEvidence } from "@lakaut/server";
import {
  type AuthenticationProfileId,
  categoryFor,
  type CreateSessionInput,
  type SdkFlowType,
  type SdkSessionStatus,
  SIGNED_DOCUMENT_MAX_PDF_BYTES,
  type SignedDocumentArtifact,
  SIGNED_DOCUMENT_PROTOCOL_VERSION,
} from "@lakaut/shared-contracts";

/** The provider's own PDF ceiling, for `SigningCoreOptions.maxDocumentBytes`. */
export const LAKAUT_MAX_DOCUMENT_BYTES: number = SIGNED_DOCUMENT_MAX_PDF_BYTES;

/**
 * The slice of `SessionClient` the spine uses.
 *
 * Narrowed deliberately: it is the whole surface a fixture has to imitate, so
 * the adapter is testable without a live call (STYLES §10), and it documents
 * exactly which provider operations the spine depends on.
 */
export type LakautSessions = Pick<
  SessionClient,
  "createSession" | "getSession" | "verifyAndAcknowledgeSignedArtifact"
>;

export interface LakautProviderOptions {
  readonly sessions: LakautSessions;
  /**
   * One concrete origin, resolved per request by the caller.
   *
   * A wildcard registered in the dashboard can never occupy this field: the
   * Hosted UI reaches the page by `postMessage`, which demands an exact target.
   */
  readonly allowedOrigin: string;
  readonly flowType: SdkFlowType;
  /** Always explicit — the default resolves differently per journey (STYLES §9.4). */
  readonly authenticationProfileId: AuthenticationProfileId;
  readonly now: Clock;
}

/**
 * Maps a session's lifecycle onto a ceremony's.
 *
 * `completed` deliberately does not become "signed": the session ending and a
 * document being signed are different facts, and only `getSignedDocumentStatus`
 * establishes the second one.
 */
function toCeremonyState(status: SdkSessionStatus): CeremonyState {
  switch (status) {
    case "created":
    case "in_progress":
    case "started":
      return "open";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "failed":
      return "failed";
  }
}

export class LakautSignatureProvider implements SignatureProvider {
  readonly #sessions: LakautSessions;
  readonly #allowedOrigin: string;
  readonly #flowType: SdkFlowType;
  readonly #authenticationProfileId: AuthenticationProfileId;
  readonly #now: Clock;

  constructor(options: LakautProviderOptions) {
    this.#sessions = options.sessions;
    this.#allowedOrigin = options.allowedOrigin;
    this.#flowType = options.flowType;
    this.#authenticationProfileId = options.authenticationProfileId;
    this.#now = options.now;
  }

  async openCeremony(document: SealedDocument, signer: SignerRole): Promise<Ceremony> {
    // Optional fields by conditional spread: `exactOptionalPropertyTypes` makes
    // assigning `undefined` a type error, not a no-op (STYLES §4).
    const input: CreateSessionInput = {
      flowType: this.#flowType,
      authenticationProfileId: this.#authenticationProfileId,
      allowedOrigin: this.#allowedOrigin,
      capabilities: ["signed-document-reconciliation:1.2"],
      ...(signer.email !== undefined ? { email: signer.email } : {}),
      ...(signer.externalUserRef !== undefined ? { externalUserRef: signer.externalUserRef } : {}),
      ...(signer.identity !== undefined
        ? {
            identitySubject: {
              dni: signer.identity.nationalId,
              sexo: signer.identity.sexo,
            },
          }
        : {}),
    };

    const created = await this.#sessions.createSession(input);

    return Object.freeze({
      ceremonyId: created.sessionId as CeremonyId,
      documentId: document.documentId,
      handoff: Object.freeze({
        provider: "lakaut",
        // Exactly `toRendererContext()`, never a hand-built object: it is what
        // strips server-only fields before anything reaches a browser (§8.2).
        context: toRendererContext(created) as unknown as Readonly<Record<string, unknown>>,
      }),
      openedAt: this.#now().toISOString(),
    });
  }

  async authoritativeStatus(ceremonyId: CeremonyId): Promise<CeremonyStatus> {
    const status = await this.#sessions.getSession(ceremonyId);

    return Object.freeze({
      ceremonyId,
      state: toCeremonyState(status.status),
      // `categoryFor` defaults an unrecognised code to `retry-in-step`, which is
      // the safe direction: escalating makes the signer redo OTP and identity.
      ...(status.errorCode !== null
        ? { disposition: categoryFor(status.errorCode), errorCode: status.errorCode }
        : {}),
      externalUserRef: status.externalUserRef,
      correlationId: status.correlationId,
      observedAt: this.#now().toISOString(),
    });
  }

  /**
   * Verifies a delivered copy, archives it, then registers the binding.
   *
   * The ordering belongs to the SDK's composite operation, not to us: it calls
   * the custody callback after verifying and before binding, and a rejection
   * there leaves nothing bound. Passing our sink straight through is what keeps
   * that guarantee (STYLES §9.5).
   *
   * The idempotency key is stable per artefact, so a retried delivery returns
   * the original binding instead of creating a second one.
   */
  async verifyArtifact(delivery: SignedDelivery, custody: CustodySink): Promise<VerifiedArtifact> {
    const artifact: SignedDocumentArtifact = {
      protocolVersion: SIGNED_DOCUMENT_PROTOCOL_VERSION,
      sessionId: delivery.ceremonyId,
      documentId: delivery.documentId,
      fileName: delivery.fileName,
      mimeType: "application/pdf",
      bytes: toArrayBuffer(delivery.bytes),
      signedContentHash: delivery.signedContentHash,
      finalPdfHash: delivery.finalPdfHash,
      algorithm: "SHA-256",
      signedAt: delivery.signedAt,
    };

    let verified: VerifiedArtifact | undefined;

    const result = await this.#sessions.verifyAndAcknowledgeSignedArtifact({
      artifact,
      idempotencyKey: `${delivery.ceremonyId}:${delivery.documentId}:custody`,
      custody: async (_artifact, evidence) => {
        verified = toVerifiedArtifact(delivery, evidence, this.#now);
        await custody(verified);
      },
    });

    if (verified === undefined) {
      throw new Error(
        `Lakaut bound ${result.binding.bindingId} without running custody, which must not happen`,
      );
    }
    return verified;
  }
}

/** A detached copy: `SignedDocumentArtifact` wants an ArrayBuffer, not a view. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/**
 * Narrows the SDK's two evidence shapes onto ours.
 *
 * `verifyAndAcknowledgeSignedArtifact` returns either the basic evidence or the
 * richer PAdES B-T record depending on how the session was configured. Both
 * carry a certificate fingerprint; only the basic one carries `certificateRef`,
 * so its absence is represented rather than invented.
 */
function toVerifiedArtifact(
  delivery: SignedDelivery,
  evidence: SignedPdfVerificationEvidence | { readonly signerCertificateFingerprint: string },
  now: Clock,
): VerifiedArtifact {
  const basic = "certificateRef" in evidence ? evidence : undefined;

  return Object.freeze({
    documentId: delivery.documentId,
    signedContentHash: delivery.signedContentHash,
    finalPdfHash: delivery.finalPdfHash,
    bytes: delivery.bytes,
    signatures: Object.freeze([
      Object.freeze({
        signerCertificateFingerprint: evidence.signerCertificateFingerprint,
        certificateRef: basic?.certificateRef ?? "",
        algorithm: basic?.algorithm ?? "SHA-256",
        signedAt: basic?.signedAt ?? delivery.signedAt,
      }),
    ]),
    verifiedAt: basic?.verifiedAt ?? now().toISOString(),
  });
}
