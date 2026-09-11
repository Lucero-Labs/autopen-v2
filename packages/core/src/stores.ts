/**
 * In-memory ports, for tests and for a caller that has not chosen a database.
 *
 * Same shape as `InMemoryPolicyRegistry` in `@autopen/gate`: the port is the
 * contract, the in-memory implementation is the one that ships, and a durable
 * store is the deploying application's problem. Nothing here survives a
 * restart, and nothing here is safe for more than one process.
 */

import type {
  Ceremony,
  CeremonyId,
  CeremonyLedger,
  CeremonyStatus,
  DocumentId,
  DocumentStore,
  SealedDocument,
} from "./signing.js";

/** Documents held in a Map, keyed by `documentId`. */
export class InMemoryDocumentStore implements DocumentStore {
  readonly #documents = new Map<DocumentId, SealedDocument>();

  async put(document: SealedDocument): Promise<void> {
    await Promise.resolve();
    this.#documents.set(document.documentId, document);
  }

  async get(documentId: DocumentId): Promise<SealedDocument | undefined> {
    await Promise.resolve();
    return this.#documents.get(documentId);
  }
}

/** Ceremonies, their latest status, and the idempotency keys already applied. */
export class InMemoryCeremonyLedger implements CeremonyLedger {
  readonly #ceremonies = new Map<CeremonyId, Ceremony>();
  readonly #statuses = new Map<CeremonyId, CeremonyStatus>();
  readonly #applied = new Set<string>();

  async record(ceremony: Ceremony): Promise<void> {
    await Promise.resolve();
    this.#ceremonies.set(ceremony.ceremonyId, ceremony);
  }

  async get(ceremonyId: CeremonyId): Promise<Ceremony | undefined> {
    await Promise.resolve();
    return this.#ceremonies.get(ceremonyId);
  }

  async settle(status: CeremonyStatus): Promise<void> {
    await Promise.resolve();
    this.#statuses.set(status.ceremonyId, status);
  }

  async latestStatus(ceremonyId: CeremonyId): Promise<CeremonyStatus | undefined> {
    await Promise.resolve();
    return this.#statuses.get(ceremonyId);
  }

  async hasApplied(idempotencyKey: string): Promise<boolean> {
    await Promise.resolve();
    return this.#applied.has(idempotencyKey);
  }

  async markApplied(idempotencyKey: string): Promise<void> {
    await Promise.resolve();
    this.#applied.add(idempotencyKey);
  }
}
