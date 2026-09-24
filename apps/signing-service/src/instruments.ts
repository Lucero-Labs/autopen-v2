/**
 * Instruments: what an issuer creates, and what a signing link points at.
 *
 * An instrument carries the one thing the core does not: the link token. The
 * token is the whole credential for the signing page, so it is generated from
 * the OS entropy source and never logged (STYLES §8.1). In memory, like every
 * other store in this app.
 */

import { randomBytes, randomUUID } from "node:crypto";

import type { CeremonyHandoff, CeremonyId, DocumentId } from "@autopen/core";

import type { InstrumentState } from "./wire.ts";

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

/** One sealed document, one signer, one link. */
export interface Instrument {
  readonly instrumentId: string;
  /** The link's only content. Never logged, never returned except inside the link. */
  readonly token: string;
  readonly reference: string;
  /** The name the product gave its PDF: what the ceremony mounts and the signer downloads. */
  readonly fileName: string;
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

/** Identifiers from `node:crypto`: a 32-byte token, base64url so it is path-safe, and a UUID. */
export const cryptoInstrumentIds: InstrumentIds = Object.freeze({
  token: () => randomBytes(32).toString("base64url"),
  instrumentId: () => randomUUID(),
});

/** Where instruments live. `put` replaces by `instrumentId`, which is how state advances. */
export interface InstrumentStore {
  put(instrument: Instrument): Promise<void>;
  findById(instrumentId: string): Promise<Instrument | undefined>;
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

/** Instruments held in Maps, reachable by id, by token, by reference and by ceremony. */
export class InMemoryInstrumentStore implements InstrumentStore {
  readonly #byId = new Map<string, Instrument>();
  readonly #byToken = new Map<string, Instrument>();
  readonly #byReference = new Map<string, Instrument>();
  readonly #byCeremony = new Map<CeremonyId, Instrument>();

  /**
   * Stores a new instrument, or advances the one already stored under its token.
   *
   * Every index is keyed by a field that never changes once set, so a re-put
   * lands over the old record in each index. A put that would change one of
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
    this.#byId.set(instrument.instrumentId, instrument);
    this.#byToken.set(instrument.token, instrument);
    this.#byReference.set(instrument.reference, instrument);
    if (instrument.ceremony !== undefined) {
      this.#byCeremony.set(instrument.ceremony.ceremonyId, instrument);
    }
  }

  /** The instrument an issuer holds the public identifier of, if any. */
  async findById(instrumentId: string): Promise<Instrument | undefined> {
    await Promise.resolve();
    return this.#byId.get(instrumentId);
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
