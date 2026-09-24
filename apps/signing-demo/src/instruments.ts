/**
 * Instruments: what an issuer creates, and what a signing link points at.
 *
 * An instrument is the demo's unit of work above the core's document and
 * ceremony. It carries the one thing the core does not: the link token. The
 * token is the whole credential for the signing page — whoever holds it can
 * open the ceremony — so it is treated like the handoff it unlocks: generated
 * from the OS entropy source, never logged, never derived from anything a
 * third party could guess (STYLES §8.1).
 *
 * In memory, like every other store in this app. Restarting forgets every link.
 */

import { randomBytes, randomUUID } from "node:crypto";

import type { CeremonyHandoff, CeremonyId, DocumentId } from "@autopen/core";

/** The signer's contact details, as the issuer supplied them. Pre-fills only. */
export interface InstrumentSigner {
  readonly email: string;
  readonly phone?: string;
}

/** The ceremony an instrument's first handoff opened, kept so a reload can resume it. */
export interface InstrumentCeremony {
  readonly ceremonyId: CeremonyId;
  readonly handoff: CeremonyHandoff;
}

/**
 * Whether the demo holds a verified signed copy.
 *
 * Two values only, and `signed` is set exclusively after `ingest` resolves:
 * the browser saying the flow completed, or the provider saying the session
 * completed, are both still `awaiting-signature` here (STYLES §9.1).
 */
export type InstrumentState = "awaiting-signature" | "signed";

/** One sealed document, one signer, one link. */
export interface Instrument {
  readonly instrumentId: string;
  /** The link's only content. Never logged, never returned except inside the link. */
  readonly token: string;
  readonly reference: string;
  readonly documentId: DocumentId;
  readonly signer: InstrumentSigner;
  readonly ceremony?: InstrumentCeremony;
  readonly state: InstrumentState;
}

/** Where the router gets its unguessable identifiers; injected so tests can watch them. */
export interface InstrumentIds {
  /** The link token. */
  token(): string;
  /** The instrument's public identifier, which the issuer keeps. */
  instrumentId(): string;
}

/**
 * Identifiers from `node:crypto`: a 32-byte base64url token and a UUID.
 *
 * 32 bytes is 256 bits, which is more than the handoff's own token carries, and
 * base64url keeps it path-safe without percent-encoding — 43 characters, no
 * padding.
 */
export const cryptoInstrumentIds: InstrumentIds = Object.freeze({
  token: () => randomBytes(32).toString("base64url"),
  instrumentId: () => randomUUID(),
});

/**
 * Where instruments live.
 *
 * Same shape as the core's ports: the interface is the contract, the in-memory
 * class is the one that ships, and a durable store is a later application's
 * problem. `put` replaces by `instrumentId`, which is how state advances.
 */
export interface InstrumentStore {
  put(instrument: Instrument): Promise<void>;
  findByToken(token: string): Promise<Instrument | undefined>;
  findByReference(reference: string): Promise<Instrument | undefined>;
  findByCeremony(ceremonyId: CeremonyId): Promise<Instrument | undefined>;
}

/** A `put` that would change a field an index is keyed by. */
export class InstrumentImmutableError extends Error {
  constructor(
    readonly instrumentId: string,
    readonly field: string,
  ) {
    super(`Instrument "${instrumentId}" cannot change its ${field} once stored`);
    this.name = new.target.name;
  }
}

/** Instruments held in Maps, reachable by token, by reference and by ceremony. */
export class InMemoryInstrumentStore implements InstrumentStore {
  readonly #byToken = new Map<string, Instrument>();
  readonly #byReference = new Map<string, Instrument>();
  readonly #byCeremony = new Map<CeremonyId, Instrument>();

  /**
   * Stores a new instrument, or advances the one already stored under its token.
   *
   * Every index is keyed by a field that never changes once set — token,
   * reference, ceremony — so a re-put with a new state lands in each index
   * over the old record and nothing goes stale. A put that would change one of
   * those fields is refused rather than indexed twice (STYLES §0.3).
   */
  async put(instrument: Instrument): Promise<void> {
    await Promise.resolve();
    const stored = this.#byToken.get(instrument.token);
    if (stored !== undefined) {
      if (stored.instrumentId !== instrument.instrumentId) {
        throw new InstrumentImmutableError(stored.instrumentId, "instrumentId");
      }
      if (stored.reference !== instrument.reference) {
        throw new InstrumentImmutableError(stored.instrumentId, "reference");
      }
      if (stored.documentId !== instrument.documentId) {
        throw new InstrumentImmutableError(stored.instrumentId, "documentId");
      }
      if (
        stored.ceremony !== undefined &&
        stored.ceremony.ceremonyId !== instrument.ceremony?.ceremonyId
      ) {
        throw new InstrumentImmutableError(stored.instrumentId, "ceremony");
      }
    }
    this.#byToken.set(instrument.token, instrument);
    this.#byReference.set(instrument.reference, instrument);
    if (instrument.ceremony !== undefined) {
      this.#byCeremony.set(instrument.ceremony.ceremonyId, instrument);
    }
  }

  /** The instrument a link token opens, if any. */
  async findByToken(token: string): Promise<Instrument | undefined> {
    await Promise.resolve();
    return this.#byToken.get(token);
  }

  /** The instrument an issuer already created under a reference, if any. */
  async findByReference(reference: string): Promise<Instrument | undefined> {
    await Promise.resolve();
    return this.#byReference.get(reference);
  }

  /** The instrument whose ceremony a delivery names, if any. */
  async findByCeremony(ceremonyId: CeremonyId): Promise<Instrument | undefined> {
    await Promise.resolve();
    return this.#byCeremony.get(ceremonyId);
  }
}
