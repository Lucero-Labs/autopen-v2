/**
 * The browser half of the Lakaut adapter, reached as `@autopen/adapter-lakaut/browser`.
 *
 * It exists for the same reason `provider.ts` does: `@lakaut/*` belongs inside
 * this package and nowhere else (STYLES §2). A Hosted UI renderer cannot hide
 * behind `SignatureProvider` — that port is asynchronous and server-side, and
 * this runs in a page — so the seam here is a different one, but the rule is
 * the same. An application mounts a ceremony and receives a `SignedDelivery`;
 * it never learns the vendor's name for anything.
 *
 * Built separately from the rest of the package (`tsconfig.browser.json`)
 * because it is the only file here that may see DOM types.
 *
 * Two vendor rules are load-bearing and are why this is a wrapper rather than a
 * re-export. `HostedUiRenderer` validates origin, window, namespace, session and
 * handshake, so nothing may add a parallel `postMessage` listener
 * (`sdk-integracion__frontend-hosted-ui.md`). And what arrives at `onSigned` is
 * a copy delivered by an untrusted client — a thing to verify against the
 * backend, never proof that anything was signed (STYLES §9.1).
 */

import type {
  CeremonyDisposition,
  CeremonyHandoff,
  CeremonyId,
  ContentHash,
  DocumentId,
  SealedDocument,
  SignedDelivery,
} from "@autopen/core";
import { HostedUiRenderer } from "@lakaut/browser";
import type {
  BrowserLifecycleEvent,
  SessionForRenderer,
  SignedDocumentArtifact,
} from "@lakaut/browser";

import { dispositionForFailure } from "./disposition.ts";

/** What a mounted ceremony offers its host: the ability to take it down. */
export interface MountedCeremony {
  /** Removes the iframe, its listeners, its timeouts and its in-memory material. */
  destroy(): void;
}

/**
 * A lifecycle notification, flattened to the fields a host can act on.
 *
 * `errorCode` and `retryable` are the whole point. A failure without its code
 * is unactionable — the difference between "the PIN was wrong, try again in
 * this step" and "the attempts are spent, this identity is done" is one string,
 * and losing it turns a recoverable step into a session nobody dares touch
 * (STYLES §9.3). `safeMessage` is the vendor's own redacted text and carries no
 * PIN, OTP or identity data.
 */
export interface CeremonyEvent {
  readonly type: string;
  readonly step?: string;
  readonly errorCode?: string;
  readonly safeMessage?: string;
  readonly retryable?: boolean;
  /** Present on a failure. What to do about it — see `dispositionForFailure`. */
  readonly disposition?: CeremonyDisposition;
}

/** Flattens the vendor's discriminated union without losing its failure detail. */
function toCeremonyEvent(event: BrowserLifecycleEvent): CeremonyEvent {
  const disposition =
    "errorCode" in event
      ? dispositionForFailure({ errorCode: event.errorCode, retryable: event.retryable })
      : undefined;

  return Object.freeze({
    type: event.type,
    ...("step" in event ? { step: event.step } : {}),
    ...("errorCode" in event ? { errorCode: event.errorCode } : {}),
    ...("safeMessage" in event && event.safeMessage !== undefined
      ? { safeMessage: event.safeMessage }
      : {}),
    ...("retryable" in event ? { retryable: event.retryable } : {}),
    ...(disposition !== undefined ? { disposition } : {}),
  });
}

/** Where to mount a ceremony, what it signs, and who hears about it. */
export interface MountCeremonyOptions {
  /**
   * The handoff a backend produced, passed through untouched.
   *
   * It is `toRendererContext()` output and carries a single-use client token,
   * so it stays in memory: never a URL, never `localStorage`, never a log
   * (STYLES §8.2).
   */
  readonly handoff: CeremonyHandoff;
  readonly container: HTMLElement;
  /** The sealed bytes to display and sign. Identity and content, together. */
  readonly document: SealedDocument;
  readonly fileName: string;
  readonly language?: string;
  /**
   * Lifecycle notification, for moving the UI and nothing else.
   *
   * `lakaut.flow.completed` means the visual experience ended. Treating it as
   * "signed" is the conflation STYLES §9.1 exists to prevent — read the
   * backend's authoritative status instead.
   */
  readonly onEvent?: (event: CeremonyEvent) => void;
  /** Receives the delivered copy. Whatever it resolves to, nothing is proven yet. */
  readonly onSigned: (delivery: SignedDelivery) => Promise<void>;
}

/** A detached copy: `HostedUiDocument` wants an ArrayBuffer, not a view. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/**
 * Restates a delivered artefact in the core's vocabulary.
 *
 * Every field the provider needs in order to cross-check the copy against its
 * own record survives the translation; dropping one would make `ingest`
 * impossible on the other side (see `SignedDelivery`).
 */
function toSignedDelivery(artifact: SignedDocumentArtifact): SignedDelivery {
  return Object.freeze({
    ceremonyId: artifact.sessionId as CeremonyId,
    documentId: artifact.documentId as DocumentId,
    fileName: artifact.fileName,
    bytes: new Uint8Array(artifact.bytes),
    signedContentHash: artifact.signedContentHash as ContentHash,
    finalPdfHash: artifact.finalPdfHash as ContentHash,
    signedAt: artifact.signedAt,
  });
}

/** Mounts the Hosted UI into `container` and starts the ceremony. */
export function mountCeremony(options: MountCeremonyOptions): MountedCeremony {
  const { onEvent } = options;

  const renderer = new HostedUiRenderer({
    session: options.handoff.context as unknown as SessionForRenderer,
    container: options.container,
    ...(options.language !== undefined ? { language: options.language } : {}),
    document: {
      documentId: options.document.documentId,
      fileName: options.fileName,
      mimeType: "application/pdf",
      bytes: toArrayBuffer(options.document.bytes),
    },
    ...(onEvent !== undefined ? { on: (event) => onEvent(toCeremonyEvent(event)) } : {}),
    onDocumentSigned: async (artifact) => {
      await options.onSigned(toSignedDelivery(artifact));
    },
  });

  renderer.mount();

  return Object.freeze({
    destroy: () => {
      renderer.destroy();
    },
  });
}
