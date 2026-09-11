/**
 * `seal` — freeze bytes against an identity. The first irreversible transition.
 *
 * The `documentId` is **derived**, not allocated: `SHA-256(reference "\n" contentHash)`.
 * That choice answers a question we could not otherwise settle. Whether the
 * provider scopes a `documentId` per session or per integrator is undocumented
 * and not observable — the document status endpoint returns an undifferentiated
 * `404 FORBIDDEN` for an unknown session and an unknown document alike, and a
 * `documentId` never reaches the provider through a server-side call at all. A
 * derived id is correct under either answer: the same reference and the same
 * bytes always produce the same id, and any change to either produces a
 * different one, so reusing an id across differing content — the thing that
 * makes `SIGN_DOCUMENT_CONFLICT` terminal — is unrepresentable rather than
 * merely forbidden (§0.3, STYLES §9.2).
 *
 * `reference` is the caller's own identifier for the instrument. It is in the
 * digest so that two instruments whose bytes happen to coincide do not collide
 * on one id, which pure content addressing would allow.
 *
 * Hashing goes through WebCrypto read off `globalThis`, so `core` keeps zero
 * dependencies and stays runtime-agnostic (STYLES §1.1, §10).
 */

import { HashUnavailableError, SealConflictError } from "./errors.js";
import type { Clock, ContentHash, DocumentId, DocumentStore, SealedDocument } from "./signing.js";

interface SubtleCryptoLike {
  digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
}

interface TextEncoderLike {
  encode(input: string): Uint8Array;
}

// Read off `globalThis` for the same reason as `subtle`: both are standard on
// every runtime we target but absent from the ES library `core` compiles
// against, and importing a Node type here would end its runtime-agnosticism.
function utf8(): TextEncoderLike {
  const Encoder = (globalThis as { TextEncoder?: new () => TextEncoderLike }).TextEncoder;
  if (typeof Encoder !== "function") {
    throw new HashUnavailableError();
  }
  return new Encoder();
}

function subtle(): SubtleCryptoLike {
  const candidate = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof (candidate as SubtleCryptoLike).digest !== "function"
  ) {
    throw new HashUnavailableError();
  }
  return candidate as SubtleCryptoLike;
}

function toHex(buffer: ArrayBuffer): string {
  let hex = "";
  for (const byte of new Uint8Array(buffer)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Lowercase hex SHA-256 over the exact bytes given. */
export async function sha256(bytes: Uint8Array): Promise<ContentHash> {
  return toHex(await subtle().digest("SHA-256", bytes)) as ContentHash;
}

/** The identity `seal` will give these bytes under this reference. */
export async function deriveDocumentId(
  reference: string,
  contentHash: ContentHash,
): Promise<DocumentId> {
  const encoded = utf8().encode(`${reference}\n${contentHash}`);
  return toHex(await subtle().digest("SHA-256", encoded)) as DocumentId;
}

const PDF_MAGIC = "%PDF-";

function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  for (let index = 0; index < PDF_MAGIC.length; index += 1) {
    if (bytes[index] !== PDF_MAGIC.charCodeAt(index)) return false;
  }
  return true;
}

/**
 * Seals bytes, or returns the existing seal when they are unchanged.
 *
 * Re-sealing identical bytes under the same reference is deliberately a no-op
 * rather than an error: a retried request must not become a conflict. Sealing
 * different bytes under an id that already exists cannot happen, because the id
 * is derived from those bytes — `SealConflictError` covers the case where a
 * store returns a record whose hash disagrees, which means the store is
 * corrupt, not that the caller made a mistake.
 */
export async function seal(options: {
  readonly bytes: Uint8Array;
  readonly reference: string;
  readonly store: DocumentStore;
  readonly now: Clock;
  readonly maxBytes: number;
}): Promise<SealedDocument> {
  const { bytes, reference, store, now, maxBytes } = options;

  if (reference === "") {
    throw new TypeError("seal requires a non-empty reference");
  }
  if (!looksLikePdf(bytes)) {
    throw new TypeError("seal expects PDF bytes: no %PDF- header");
  }
  if (bytes.length > maxBytes) {
    throw new TypeError(`seal expects at most ${maxBytes} bytes, got ${bytes.length}`);
  }

  const contentHash = await sha256(bytes);
  const documentId = await deriveDocumentId(reference, contentHash);

  const existing = await store.get(documentId);
  if (existing !== undefined) {
    if (existing.contentHash !== contentHash) {
      throw new SealConflictError(documentId, existing.contentHash, contentHash);
    }
    return existing;
  }

  // A copy, so a caller still writing into its own buffer cannot change what
  // was sealed after the fact.
  const sealed: SealedDocument = Object.freeze({
    documentId,
    contentHash,
    bytes: Uint8Array.from(bytes),
    sealedAt: now().toISOString(),
  });

  await store.put(sealed);
  return sealed;
}
