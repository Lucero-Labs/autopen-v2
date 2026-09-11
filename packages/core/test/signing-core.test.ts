import { describe, expect, it } from "vitest";

import {
  CeremonyNotFoundError,
  CustodyFailedError,
  DocumentNotSealedError,
} from "../src/errors.js";
import { DefaultSigningCore } from "../src/signing-core.js";
import type {
  Ceremony,
  CeremonyId,
  CeremonyStatus,
  Clock,
  ContentHash,
  CustodySink,
  DocumentId,
  SealedDocument,
  SignatureProvider,
  SignedDelivery,
  SignerRole,
  VerifiedArtifact,
} from "../src/signing.js";
import { InMemoryCeremonyLedger, InMemoryDocumentStore } from "../src/stores.js";

const AT = new Date("2026-09-11T12:00:00.000Z");
const now: Clock = () => AT;
const SIGNER: SignerRole = { role: "librador" };

/** ASCII bytes, hand-encoded so core's tests stay free of runtime globals (STYLES 10). */
function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

function pdf(body: string): Uint8Array {
  return ascii(`%PDF-1.7 ${body}`);
}

/** Records what the core asked of a provider, and answers however a test needs. */
class FakeProvider implements SignatureProvider {
  readonly opened: SealedDocument[] = [];
  readonly statusCalls: CeremonyId[] = [];
  custodyRan = false;
  verifyThrows: Error | undefined;

  async openCeremony(document: SealedDocument): Promise<Ceremony> {
    this.opened.push(document);
    return {
      ceremonyId: "ceremony-1" as CeremonyId,
      documentId: document.documentId,
      handoff: { provider: "fake", context: {} },
      openedAt: AT.toISOString(),
    };
  }

  async authoritativeStatus(ceremonyId: CeremonyId): Promise<CeremonyStatus> {
    this.statusCalls.push(ceremonyId);
    return {
      ceremonyId,
      state: "completed",
      externalUserRef: "loan-4821",
      correlationId: "sdk_2b9d",
      observedAt: AT.toISOString(),
    };
  }

  async verifyArtifact(delivery: SignedDelivery, custody: CustodySink): Promise<VerifiedArtifact> {
    if (this.verifyThrows !== undefined) throw this.verifyThrows;

    const artifact: VerifiedArtifact = {
      documentId: delivery.documentId,
      signedContentHash: delivery.signedContentHash,
      finalPdfHash: delivery.finalPdfHash,
      bytes: delivery.bytes,
      signatures: [],
      verifiedAt: AT.toISOString(),
    };

    // The real provider runs custody before registering the binding, and the
    // binding is what this return value stands for.
    await custody(artifact);
    this.custodyRan = true;
    return artifact;
  }
}

function build(provider = new FakeProvider()) {
  const documents = new InMemoryDocumentStore();
  const ceremonies = new InMemoryCeremonyLedger();
  const core = new DefaultSigningCore({
    provider,
    documents,
    ceremonies,
    now,
    maxDocumentBytes: 20 * 1024 * 1024,
  });
  return { core, provider, documents, ceremonies };
}

describe("openCeremony", () => {
  it("refuses a document that was never sealed rather than asking the provider", async () => {
    const { core, provider } = build();

    await expect(core.openCeremony("not-sealed" as DocumentId, SIGNER)).rejects.toBeInstanceOf(
      DocumentNotSealedError,
    );
    expect(provider.opened).toHaveLength(0);
  });

  it("records the ceremony so an arriving webhook can be attributed to it", async () => {
    const { core, ceremonies } = build();
    const sealed = await core.seal(pdf("uno"), "ar.pagare/0001");

    const ceremony = await core.openCeremony(sealed.documentId, SIGNER);

    expect(await ceremonies.get(ceremony.ceremonyId)).toEqual(ceremony);
  });

  it("hands the provider the sealed bytes, not the caller's", async () => {
    const { core, provider } = build();
    const sealed = await core.seal(pdf("uno"), "ar.pagare/0001");

    await core.openCeremony(sealed.documentId, SIGNER);

    expect(provider.opened[0]?.contentHash).toBe(sealed.contentHash);
  });
});

function delivery(overrides: Partial<SignedDelivery> = {}): SignedDelivery {
  return {
    ceremonyId: "ceremony-1" as CeremonyId,
    documentId: "doc-1" as DocumentId,
    fileName: "pagare.pdf",
    bytes: pdf("firmado"),
    signedContentHash: "a".repeat(64) as ContentHash,
    finalPdfHash: "b".repeat(64) as ContentHash,
    signedAt: AT.toISOString(),
    ...overrides,
  };
}

/** Seals a document and opens its ceremony, which is ingest's precondition. */
async function readyToIngest() {
  const built = build();
  const sealed = await built.core.seal(pdf("uno"), "ar.pagare/0001");
  const ceremony = await built.core.openCeremony(sealed.documentId, SIGNER);
  return { ...built, sealed, ceremony };
}

describe("ingest", () => {
  it("refuses a document that was never sealed", async () => {
    const { core } = build();

    await expect(core.ingest(delivery(), async () => {})).rejects.toBeInstanceOf(
      DocumentNotSealedError,
    );
  });

  it("refuses a delivery for a ceremony the ledger never recorded", async () => {
    const { core } = build();
    const sealed = await core.seal(pdf("uno"), "ar.pagare/0001");

    await expect(
      core.ingest(delivery({ documentId: sealed.documentId }), async () => {}),
    ).rejects.toBeInstanceOf(CeremonyNotFoundError);
  });

  it("lets the provider run custody, because it must finish before the binding", async () => {
    const { core, provider, sealed, ceremony } = await readyToIngest();
    const archived: VerifiedArtifact[] = [];

    await core.ingest(
      delivery({ documentId: sealed.documentId, ceremonyId: ceremony.ceremonyId }),
      async (artifact) => {
        archived.push(artifact);
      },
    );

    expect(archived).toHaveLength(1);
    expect(provider.custodyRan).toBe(true);
  });

  it("fails the whole ingest when custody rejects, rather than reporting success", async () => {
    const { core, sealed, ceremony } = await readyToIngest();
    const disk = new Error("archive is full");

    const failure = await core
      .ingest(
        delivery({ documentId: sealed.documentId, ceremonyId: ceremony.ceremonyId }),
        async () => {
          throw disk;
        },
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CustodyFailedError);
    expect((failure as CustodyFailedError).cause).toBe(disk);
    expect((failure as CustodyFailedError).documentId).toBe(sealed.documentId);
  });

  it("keeps the provider's own failure as the cause rather than swallowing it", async () => {
    const provider = new FakeProvider();
    provider.verifyThrows = new Error("SIGN_DOCUMENT_CONFLICT");
    const built = build(provider);
    const sealed = await built.core.seal(pdf("uno"), "ar.pagare/0001");
    const ceremony = await built.core.openCeremony(sealed.documentId, SIGNER);

    const failure = await built.core
      .ingest(
        delivery({ documentId: sealed.documentId, ceremonyId: ceremony.ceremonyId }),
        async () => {},
      )
      .catch((error: unknown) => error);

    expect((failure as CustodyFailedError).cause).toBeInstanceOf(Error);
    expect(((failure as CustodyFailedError).cause as Error).message).toBe("SIGN_DOCUMENT_CONFLICT");
  });
});

describe("reconcile", () => {
  it("reads the provider's authoritative record rather than trusting anything delivered", async () => {
    const { core, provider } = build();

    const status = await core.reconcile("ceremony-1" as CeremonyId);

    expect(provider.statusCalls).toEqual(["ceremony-1"]);
    expect(status.state).toBe("completed");
  });

  it("settles the ledger so a repeat read does not have to hit the provider again", async () => {
    const { core, ceremonies } = build();

    const status = await core.reconcile("ceremony-1" as CeremonyId);

    expect(await ceremonies.latestStatus("ceremony-1" as CeremonyId)).toEqual(status);
  });

  it("carries the correlation id, the only handle vendor support can trace", async () => {
    const { core } = build();

    const status = await core.reconcile("ceremony-1" as CeremonyId);

    expect(status.correlationId).toBe("sdk_2b9d");
    expect(status.externalUserRef).toBe("loan-4821");
  });
});
