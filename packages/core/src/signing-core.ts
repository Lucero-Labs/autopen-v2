/**
 * The spine, wired to its ports.
 *
 * Takes everything it cannot determine — the provider, the stores, the clock —
 * as constructor options (STYLES §2, §4). The only behaviour here that is not
 * delegation is refusal: every path that cannot establish what it needs throws
 * rather than proceeding on an assumption.
 */

import { CeremonyNotFoundError, CustodyFailedError, DocumentNotSealedError } from "./errors.js";
import { seal } from "./seal.js";
import type {
  Ceremony,
  CeremonyId,
  CeremonyLedger,
  CeremonyStatus,
  Clock,
  CustodySink,
  DocumentId,
  DocumentStore,
  SealedDocument,
  SignatureProvider,
  SignedDelivery,
  SignerRole,
  SigningCore,
  VerifiedArtifact,
} from "./signing.js";

export interface SigningCoreOptions {
  readonly provider: SignatureProvider;
  readonly documents: DocumentStore;
  readonly ceremonies: CeremonyLedger;
  readonly now: Clock;
  /**
   * The provider's own PDF size ceiling. Passed in rather than hardcoded
   * because it is a provider fact, and `core` does not import the adapter.
   */
  readonly maxDocumentBytes: number;
}

export class DefaultSigningCore implements SigningCore {
  readonly #provider: SignatureProvider;
  readonly #documents: DocumentStore;
  readonly #ceremonies: CeremonyLedger;
  readonly #now: Clock;
  readonly #maxDocumentBytes: number;

  constructor(options: SigningCoreOptions) {
    this.#provider = options.provider;
    this.#documents = options.documents;
    this.#ceremonies = options.ceremonies;
    this.#now = options.now;
    this.#maxDocumentBytes = options.maxDocumentBytes;
  }

  async seal(bytes: Uint8Array, reference: string): Promise<SealedDocument> {
    return seal({
      bytes,
      reference,
      store: this.#documents,
      now: this.#now,
      maxBytes: this.#maxDocumentBytes,
    });
  }

  async openCeremony(documentId: DocumentId, signer: SignerRole): Promise<Ceremony> {
    const document = await this.#documents.get(documentId);
    if (document === undefined) {
      throw new DocumentNotSealedError(documentId);
    }

    const ceremony = await this.#provider.openCeremony(document, signer);
    await this.#ceremonies.record(ceremony);
    return ceremony;
  }

  /**
   * Verifies delivered bytes and archives them, in that order.
   *
   * The custody sink is handed to the provider rather than called here, because
   * it has to run before the binding is registered (STYLES §9.5). A sink that
   * rejects therefore cancels the binding; the failure is wrapped so the
   * original is never lost (STYLES §6.1).
   */
  async ingest(delivery: SignedDelivery, custody: CustodySink): Promise<VerifiedArtifact> {
    const document = await this.#documents.get(delivery.documentId);
    if (document === undefined) {
      throw new DocumentNotSealedError(delivery.documentId);
    }

    const ceremony = await this.#ceremonies.get(delivery.ceremonyId);
    if (ceremony === undefined) {
      throw new CeremonyNotFoundError(delivery.ceremonyId);
    }

    try {
      return await this.#provider.verifyArtifact(delivery, custody);
    } catch (error) {
      throw new CustodyFailedError(delivery.documentId, error);
    }
  }

  /**
   * Settles a ceremony from the provider's authoritative record.
   *
   * Reads rather than trusts: this is the only path to a terminal state, and a
   * browser event is never one of its inputs (STYLES §9.1).
   */
  async reconcile(ceremonyId: CeremonyId): Promise<CeremonyStatus> {
    const status = await this.#provider.authoritativeStatus(ceremonyId);
    await this.#ceremonies.settle(status);
    return status;
  }
}
