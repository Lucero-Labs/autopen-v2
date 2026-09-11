import { describe, expect, it } from "vitest";

import { HashUnavailableError, SealConflictError } from "../src/errors.js";
import { deriveDocumentId, seal, sha256 } from "../src/seal.js";
import type { Clock, ContentHash, SealedDocument } from "../src/signing.js";
import { InMemoryDocumentStore } from "../src/stores.js";

const AT = new Date("2026-09-11T12:00:00.000Z");
const clock: Clock = () => AT;

/** ASCII bytes, hand-encoded so core's tests stay free of runtime globals (STYLES 10). */
function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function pdf(body: string): Uint8Array {
  return ascii(`%PDF-1.7 ${body}`);
}

function sealing(store = new InMemoryDocumentStore()) {
  return {
    store,
    run: (bytes: Uint8Array, reference = "ar.pagare/0001") =>
      seal({ bytes, reference, store, now: clock, maxBytes: 20 * 1024 * 1024 }),
  };
}

describe("seal", () => {
  it("gives identical bytes under one reference the same identity every time", async () => {
    const first = await sealing().run(pdf("uno"));
    const second = await sealing().run(pdf("uno"));

    expect(second.documentId).toBe(first.documentId);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it("gives different bytes a different identity, so one id can never cover two contents", async () => {
    const first = await sealing().run(pdf("uno"));
    const second = await sealing().run(pdf("dos"));

    expect(second.documentId).not.toBe(first.documentId);
  });

  it("separates two instruments whose bytes happen to be identical", async () => {
    const bytes = pdf("same");
    const first = await sealing().run(bytes, "ar.pagare/0001");
    const second = await sealing().run(bytes, "ar.pagare/0002");

    expect(first.contentHash).toBe(second.contentHash);
    expect(first.documentId).not.toBe(second.documentId);
  });

  it("returns the existing seal rather than failing when the same bytes are sealed twice", async () => {
    const { run } = sealing();
    const first = await run(pdf("retry"));
    const second = await run(pdf("retry"));

    expect(second).toEqual(first);
  });

  it("keeps a copy, so a caller still writing to its buffer cannot change what was sealed", async () => {
    const bytes = pdf("original");
    const sealed = await sealing().run(bytes);
    const before = sealed.bytes.slice();

    bytes[bytes.length - 1] = 0x00;

    expect(Array.from(sealed.bytes)).toEqual(Array.from(before));
  });

  it("refuses bytes that are not a PDF", async () => {
    await expect(sealing().run(ascii("PK"))).rejects.toThrow(/%PDF-/);
  });

  it("refuses a document over the provider's ceiling", async () => {
    const store = new InMemoryDocumentStore();

    await expect(
      seal({ bytes: pdf("x".repeat(100)), reference: "r", store, now: clock, maxBytes: 32 }),
    ).rejects.toThrow(/at most 32 bytes/);
  });

  it("refuses an empty reference rather than deriving an id nobody can attribute", async () => {
    await expect(sealing().run(pdf("uno"), "")).rejects.toThrow(/non-empty reference/);
  });

  it("refuses a stored document whose hash disagrees with the id it is filed under", async () => {
    const store = new InMemoryDocumentStore();
    const bytes = pdf("uno");
    const contentHash = await sha256(bytes);
    const documentId = await deriveDocumentId("ar.pagare/0001", contentHash);
    const corrupt: SealedDocument = Object.freeze({
      documentId,
      contentHash: "0".repeat(64) as ContentHash,
      bytes,
      sealedAt: AT.toISOString(),
    });
    await store.put(corrupt);

    await expect(sealing(store).run(bytes)).rejects.toBeInstanceOf(SealConflictError);
  });
});

describe("determinism, because the hash is the point", () => {
  it("derives the same identity on two runs whose clocks disagree", async () => {
    const bytes = pdf("determinism");
    const early = await seal({
      bytes,
      reference: "ar.pagare/0001",
      store: new InMemoryDocumentStore(),
      now: () => new Date("2020-01-01T00:00:00.000Z"),
      maxBytes: 1024,
    });
    const late = await seal({
      bytes,
      reference: "ar.pagare/0001",
      store: new InMemoryDocumentStore(),
      now: () => new Date("2031-12-31T23:59:59.000Z"),
      maxBytes: 1024,
    });

    // The clock reaches `sealedAt` and nothing that is hashed (STYLES 7.2).
    expect(late.documentId).toBe(early.documentId);
    expect(late.contentHash).toBe(early.contentHash);
    expect(late.sealedAt).not.toBe(early.sealedAt);
  });

  it("hashes no bytes to the published SHA-256 of the empty input", async () => {
    expect(await sha256(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("when the runtime has no WebCrypto", () => {
  it("throws rather than sealing something it cannot hash", async () => {
    const original = Reflect.getOwnPropertyDescriptor(globalThis, "crypto");
    Reflect.deleteProperty(globalThis, "crypto");

    try {
      await expect(sha256(new Uint8Array([1]))).rejects.toBeInstanceOf(HashUnavailableError);
    } finally {
      if (original !== undefined) {
        Reflect.defineProperty(globalThis, "crypto", original);
      }
    }
  });
});
