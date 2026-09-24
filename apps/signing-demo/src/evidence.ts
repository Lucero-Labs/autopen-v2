/**
 * Custody for the demo: a directory of verified signed copies and their manifests.
 *
 * The write is the custody sink the core runs between verifying a delivery and
 * registering its binding, so a rejection here cancels the binding rather than
 * leaving an artefact bound but unarchived (STYLES §9.5). The read is what
 * `GET /api/instruments/{id}/artifact` serves. Both sides sit in one store so
 * the thing that archived a copy is the thing asked to produce it.
 *
 * A directory, not a database: this is the demo's stand-in for durable custody.
 * The *ordering* is not a stand-in.
 */

import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DocumentId, VerifiedArtifact } from "@autopen/core";

/** A document id is a sha-256 hex digest; anything else must never become a file name. */
const DOCUMENT_ID_SHAPE = /^[0-9a-f]{64}$/;

/** Where verified signed copies go, and where they are read back from. */
export interface EvidenceStore {
  /** Durable custody of a verified copy. Runs before the binding; rejecting refuses it (§9.5). */
  archive(artifact: VerifiedArtifact): Promise<void>;
  /** The archived signed PDF for a document, or `undefined` when none was ever archived. */
  readArtifact(documentId: DocumentId): Promise<Uint8Array | undefined>;
}

/**
 * The evidence directory cannot be written, so the process must not start.
 *
 * Raised at boot rather than at the first delivery: a signed copy that cannot
 * be archived cancels the binding, and discovering that after a signer has
 * spent a PIN is the expensive way (STYLES §0.1). The directory is a path and
 * safe to name.
 */
export class EvidenceDirectoryUnwritableError extends Error {
  constructor(
    readonly directory: string,
    options?: { readonly cause: unknown },
  ) {
    super(`evidence directory ${directory} is not writable`, options);
    this.name = new.target.name;
  }
}

/** A missing file, as opposed to a directory that cannot be read at all. */
function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}

/** The id as a file stem, or a thrown bug: an id of any other shape could name a path. */
function fileStem(documentId: string): string {
  if (!DOCUMENT_ID_SHAPE.test(documentId)) {
    throw new Error("document id is not a sha-256 hex digest and cannot name a file");
  }
  return documentId;
}

/**
 * Writes each artefact as `<documentId>.pdf` beside a `<documentId>.json` manifest.
 *
 * The directory is created on first write, so a freshly mounted volume needs
 * no preparation. Failing the write is the correct way to fail: the core then
 * cancels the binding.
 */
export class DirectoryEvidenceStore implements EvidenceStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  /**
   * Creates the directory if needed and proves it can be written, or throws
   * `EvidenceDirectoryUnwritableError`.
   *
   * For boot. A volume mounted read-only, or owned by another user, otherwise
   * surfaces as the first delivery's binding being cancelled.
   */
  async ensureWritable(): Promise<void> {
    try {
      await mkdir(this.#directory, { recursive: true });
      await access(this.#directory, constants.W_OK);
    } catch (cause) {
      throw new EvidenceDirectoryUnwritableError(this.#directory, { cause });
    }
  }

  async archive(artifact: VerifiedArtifact): Promise<void> {
    const stem = fileStem(artifact.documentId);
    await mkdir(this.#directory, { recursive: true });
    // Two plain writes, no fsync and no write-then-rename: not the vendor's
    // "custodia durable" idiom, and a crash between them leaves a PDF without
    // its manifest. The Postgres store replaces this; the demo does not fix it.
    await writeFile(join(this.#directory, `${stem}.pdf`), artifact.bytes);
    await writeFile(
      join(this.#directory, `${stem}.json`),
      JSON.stringify(
        {
          documentId: artifact.documentId,
          signedContentHash: artifact.signedContentHash,
          finalPdfHash: artifact.finalPdfHash,
          signatures: artifact.signatures,
          verifiedAt: artifact.verifiedAt,
        },
        null,
        2,
      ),
    );
  }

  async readArtifact(documentId: DocumentId): Promise<Uint8Array | undefined> {
    const stem = fileStem(documentId);
    try {
      return new Uint8Array(await readFile(join(this.#directory, `${stem}.pdf`)));
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }
}
