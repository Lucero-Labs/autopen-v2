import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DocumentId, VerifiedArtifact } from "@autopen/core";

import { DirectoryEvidenceStore, EvidenceDirectoryUnwritableError } from "../src/evidence.ts";

const DOCUMENT_ID = "a".repeat(64) as DocumentId;

const ARTIFACT: VerifiedArtifact = Object.freeze({
  documentId: DOCUMENT_ID,
  signedContentHash: "b".repeat(64) as VerifiedArtifact["signedContentHash"],
  finalPdfHash: "c".repeat(64) as VerifiedArtifact["finalPdfHash"],
  bytes: new Uint8Array(Buffer.from("%PDF-1.7 signed")),
  signatures: [],
  verifiedAt: "2026-09-24T12:00:00.000Z",
});

/** Root can write anything, so a read-only directory proves nothing under it. */
const IS_ROOT = process.getuid?.() === 0;

let scratch: string;

afterEach(async () => {
  await chmod(scratch, 0o700).catch(() => undefined);
  await rm(scratch, { recursive: true, force: true });
});

async function freshScratch(): Promise<string> {
  scratch = await mkdtemp(join(tmpdir(), "evidence-"));
  return scratch;
}

describe("DirectoryEvidenceStore", () => {
  it("creates the directory on ensureWritable and then archives and reads back the same bytes", async () => {
    const directory = join(await freshScratch(), "nested", "evidence");
    const store = new DirectoryEvidenceStore(directory);

    await store.ensureWritable();
    await store.archive(ARTIFACT);

    expect(await store.readArtifact(DOCUMENT_ID)).toEqual(ARTIFACT.bytes);
    expect(JSON.parse(await readFile(join(directory, `${DOCUMENT_ID}.json`), "utf8"))).toEqual({
      documentId: DOCUMENT_ID,
      signedContentHash: ARTIFACT.signedContentHash,
      finalPdfHash: ARTIFACT.finalPdfHash,
      signatures: [],
      verifiedAt: ARTIFACT.verifiedAt,
    });
  });

  it("reads undefined for a document nothing archived", async () => {
    const store = new DirectoryEvidenceStore(await freshScratch());

    expect(await store.readArtifact("d".repeat(64) as DocumentId)).toBeUndefined();
  });

  it("refuses a document id that is not a sha-256 hex digest before it can name a file", async () => {
    const store = new DirectoryEvidenceStore(await freshScratch());
    const traversal = "../escape" as DocumentId;

    await expect(store.readArtifact(traversal)).rejects.toThrow(
      "document id is not a sha-256 hex digest and cannot name a file",
    );
    await expect(store.archive({ ...ARTIFACT, documentId: traversal })).rejects.toThrow(
      "document id is not a sha-256 hex digest and cannot name a file",
    );
    await expect(store.readArtifact("A".repeat(64) as DocumentId)).rejects.toThrow();
  });

  it.skipIf(IS_ROOT)(
    "fails ensureWritable against a read-only parent with the path in the message and nothing else",
    async () => {
      const parent = await freshScratch();
      await chmod(parent, 0o500);
      const directory = join(parent, "evidence");

      const failure = await new DirectoryEvidenceStore(directory).ensureWritable().catch((e) => e);

      expect(failure).toBeInstanceOf(EvidenceDirectoryUnwritableError);
      expect((failure as EvidenceDirectoryUnwritableError).directory).toBe(directory);
      expect((failure as Error).message).toBe(`evidence directory ${directory} is not writable`);
      expect((failure as Error).cause).toBeDefined();
    },
  );
});
