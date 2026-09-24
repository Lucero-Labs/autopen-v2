import { describe, expect, it } from "vitest";

import type { CeremonyId, DocumentId } from "@autopen/core";

import {
  InMemoryInstrumentStore,
  type Instrument,
  InstrumentImmutableError,
} from "../src/instruments.ts";

const STORED: Instrument = Object.freeze({
  instrumentId: "instrument-1",
  token: "token-never-logged",
  reference: "harness/test-1",
  fileName: "test-1.pdf",
  documentId: "a".repeat(64) as DocumentId,
  signer: Object.freeze({ email: "firmante@example.invalid" }),
  state: "awaiting-signature",
});

describe("InMemoryInstrumentStore.put", () => {
  it("advances state under the same token, and every index finds the new record", async () => {
    const store = new InMemoryInstrumentStore();
    await store.put(STORED);

    const ceremony = Object.freeze({
      ceremonyId: "session-1" as CeremonyId,
      handoff: { provider: "fake", context: {} },
    });
    await store.put(Object.freeze({ ...STORED, ceremony, state: "signed" }));

    expect(await store.findById(STORED.instrumentId)).toMatchObject({ state: "signed" });
    expect(await store.findByToken(STORED.token)).toMatchObject({ state: "signed" });
    expect(await store.findByReference(STORED.reference)).toMatchObject({ state: "signed" });
    expect(await store.findByCeremony(ceremony.ceremonyId)).toMatchObject({ state: "signed" });
  });

  it("refuses a put that changes an indexed field, naming the instrument and field", async () => {
    const store = new InMemoryInstrumentStore();
    await store.put(STORED);

    const changed = store.put(Object.freeze({ ...STORED, reference: "harness/test-2" }));

    await expect(changed).rejects.toBeInstanceOf(InstrumentImmutableError);
    await expect(changed).rejects.toMatchObject({
      name: "InstrumentImmutableError",
      instrumentId: "instrument-1",
      field: "reference",
      message: 'Instrument "instrument-1" cannot change its reference once stored',
    });
    expect(await store.findByReference("harness/test-2")).toBeUndefined();
    expect(await store.findByReference(STORED.reference)).toEqual(STORED);
  });

  it("refuses a change of documentId and of an opened ceremony the same way", async () => {
    const store = new InMemoryInstrumentStore();
    const ceremony = Object.freeze({
      ceremonyId: "session-1" as CeremonyId,
      handoff: { provider: "fake", context: {} },
    });
    await store.put(Object.freeze({ ...STORED, ceremony }));

    await expect(
      store.put(Object.freeze({ ...STORED, ceremony, documentId: "b".repeat(64) as DocumentId })),
    ).rejects.toMatchObject({ field: "documentId" });
    await expect(
      store.put(
        Object.freeze({
          ...STORED,
          ceremony: { ...ceremony, ceremonyId: "session-2" as CeremonyId },
        }),
      ),
    ).rejects.toMatchObject({ field: "ceremony" });
  });
});
