/**
 * The signing page: what a link opens, and the only thing a signer sees.
 *
 * The token in the path is the whole input; the page asks the backend for its
 * handoff, mounts the ceremony, and posts back what the ceremony delivers.
 * Every decision is the backend's (`src/routes.ts`). No `@lakaut/*` import:
 * the renderer lives behind `@autopen/adapter-lakaut/browser` (STYLES §2).
 * `lakaut.flow.completed` moves the status line and nothing else; "signed" is
 * written only once the backend has verified the copy (STYLES §9.1).
 */

import {
  type CeremonyEvent,
  mountCeremony,
  type MountedCeremony,
} from "@autopen/adapter-lakaut/browser";
import type {
  CeremonyHandoff,
  ContentHash,
  DocumentId,
  SealedDocument,
  SignedDelivery,
} from "@autopen/core";

import type { ErrorResponse, HandoffResponse, SigningStatus, StatusResponse } from "../src/wire.ts";
import { DETAIL_LINES, STATUS_LINES } from "./status-lines.ts";

const status = document.querySelector("#status") as HTMLElement;
const detail = document.querySelector("#detail") as HTMLElement;
const retry = document.querySelector("#retry") as HTMLButtonElement;
const container = document.querySelector("#lakaut-hosted-ui") as HTMLElement;

/** The last path segment of `/sign/{token}`. */
const token = window.location.pathname
  .split("/")
  .filter((segment) => segment !== "")
  .at(-1);

let mounted: MountedCeremony | undefined;
let onRetry: (() => void) | undefined;

/** A failure with a line written for the signer; what went wrong goes to the console. */
class SignerFacingError extends Error {
  constructor(
    readonly line: string,
    detailForConsole: string,
  ) {
    super(detailForConsole);
    this.name = new.target.name;
  }
}

function say(line: string): void {
  status.textContent = line;
}

function note(line: string, fault = false): void {
  detail.textContent = line;
  detail.className = fault ? "fault" : "";
}

function describeError(error: unknown): string {
  return `${DETAIL_LINES.error} ${error instanceof Error ? error.message : DETAIL_LINES.unknownError}`;
}

/** Shows the failure the way the signer should see it, and logs the rest. */
function report(error: unknown): void {
  if (error instanceof SignerFacingError) {
    console.error(error.message);
    say(error.line);
    note("");
    return;
  }
  say(STATUS_LINES.failed);
  note(describeError(error), true);
}

/** Shows the one retry button, bound to whatever the last failure needs redone. */
function offerRetry(action: () => void): void {
  onRetry = action;
  retry.hidden = false;
}

function withdrawRetry(): void {
  onRetry = undefined;
  retry.hidden = true;
}

retry.addEventListener("click", () => {
  const action = onRetry;
  withdrawRetry();
  action?.();
});

/**
 * Refuses to mount into an origin the session was not issued for.
 *
 * The Hosted UI declines to be framed by any other origin, and the browser
 * reports that as a bare "refused to connect" that names neither one; the API
 * validates the origin it is given, not the one the page is served from. So
 * check here, where both are known. A handoff that states no origin fails the
 * same way (STYLES §0.1).
 */
function assertOriginMatches(handoff: CeremonyHandoff): void {
  const issuedFor = handoff.context.allowedOrigin;
  if (issuedFor !== window.location.origin) {
    throw new SignerFacingError(
      STATUS_LINES.wrongPage,
      `the session was issued for ${typeof issuedFor === "string" ? issuedFor : "no origin"} ` +
        `but the page is at ${window.location.origin}`,
    );
  }
}

function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The error an `ErrorResponse` body carries, or the HTTP status. */
function errorOf(response: Response, payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const body = payload as ErrorResponse;
    return body.correlationId !== undefined
      ? `${body.error} (correlationId=${body.correlationId})`
      : body.error;
  }
  return `HTTP ${response.status}`;
}

async function post(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const payload: unknown = await response.json();
  if (!response.ok) throw new Error(errorOf(response, payload));
  return payload;
}

/** The fields of an event worth showing: the code and whether it can be retried, above all. */
function describeEvent(event: CeremonyEvent): string {
  return [
    event.type,
    event.step !== undefined ? `step=${event.step}` : "",
    event.errorCode !== undefined ? `errorCode=${event.errorCode}` : "",
    event.retryable !== undefined ? `retryable=${String(event.retryable)}` : "",
    event.disposition !== undefined ? `disposition=${event.disposition}` : "",
    event.safeMessage ?? "",
  ]
    .filter((part) => part !== "")
    .join("  ");
}

/** The line a final state earns, or `undefined` while something is still pending. */
function lineFor(state: SigningStatus): string | undefined {
  switch (state) {
    case "signed":
      return STATUS_LINES.signed;
    case "cancelled":
      return STATUS_LINES.cancelled;
    case "expired":
      return STATUS_LINES.expired;
    case "failed":
      return STATUS_LINES.failed;
    case "awaiting-delivery":
    case "awaiting-signature":
      return undefined;
  }
}

function describeCeremony(ceremony: NonNullable<StatusResponse["ceremony"]>): string {
  return [
    `${DETAIL_LINES.authoritativeState} ${ceremony.state}`,
    ceremony.errorCode !== undefined ? `errorCode=${ceremony.errorCode}` : "",
    ceremony.disposition !== undefined ? `disposition=${ceremony.disposition}` : "",
    `correlationId=${ceremony.correlationId}`,
  ]
    .filter((part) => part !== "")
    .join("  ");
}

/**
 * Reads the backend's view and moves the line only for a state that is final.
 *
 * `awaiting-*` is left alone: a flow whose delivery is still being verified
 * must not be told anything less than "verificando".
 */
async function readStatus(): Promise<void> {
  if (token === undefined) return;
  const response = await fetch(`/api/sign/${encodeURIComponent(token)}/status`);
  const payload: unknown = await response.json();
  if (!response.ok) {
    note(`${DETAIL_LINES.statusUnreadable} ${errorOf(response, payload)}`, true);
    return;
  }

  const read = payload as StatusResponse;
  if (read.ceremony !== undefined) note(describeCeremony(read.ceremony));
  const line = lineFor(read.state);
  if (line !== undefined) say(line);
}

/**
 * Posts the delivered copy for verification, and offers to post it again.
 *
 * Rejects when the backend did not confirm receipt: the renderer passes the
 * rejection to the Hosted UI, and only a rejection makes it emit
 * `signed_document_delivery_failed` and keep the signer's download option
 * (`sdk-integracion__documentos-firma.md`, "Falla de entrega"). The retry
 * posts the same bytes again and never mounts a second ceremony: the document
 * is already signed at the provider (STYLES §9.1).
 */
async function deliver(linkToken: string, delivery: SignedDelivery): Promise<void> {
  say(STATUS_LINES.verifying);
  try {
    await post(`/api/sign/${encodeURIComponent(linkToken)}/deliveries`, {
      ceremonyId: delivery.ceremonyId,
      documentId: delivery.documentId,
      fileName: delivery.fileName,
      bytesBase64: base64FromBytes(delivery.bytes),
      signedContentHash: delivery.signedContentHash,
      finalPdfHash: delivery.finalPdfHash,
      signedAt: delivery.signedAt,
    });
    say(STATUS_LINES.signed);
    note(DETAIL_LINES.archived);
  } catch (error) {
    say(STATUS_LINES.deliveryFailed);
    note(describeError(error), true);
    offerRetry(() => {
      deliver(linkToken, delivery).catch(report);
    });
    throw error;
  }
}

async function start(): Promise<void> {
  withdrawRetry();
  say(STATUS_LINES.preparing);
  note("");

  if (token === undefined) {
    say(STATUS_LINES.notFound);
    return;
  }

  const response = await fetch(`/api/sign/${encodeURIComponent(token)}/handoff`, {
    method: "POST",
  });
  const payload: unknown = await response.json();
  if (response.status === 404) {
    say(STATUS_LINES.notFound);
    return;
  }
  if (!response.ok) throw new Error(errorOf(response, payload));

  const opened = payload as HandoffResponse | StatusResponse;
  if (!("handoff" in opened)) {
    // Nothing to mount: signed already, or a session that ended without a signature.
    if (opened.ceremony !== undefined) note(describeCeremony(opened.ceremony));
    say(
      opened.state === "signed"
        ? STATUS_LINES.alreadySigned
        : (lineFor(opened.state) ?? STATUS_LINES.awaitingDelivery),
    );
    return;
  }

  assertOriginMatches(opened.handoff);

  const sealed: SealedDocument = {
    documentId: opened.document.documentId as DocumentId,
    contentHash: opened.document.contentHash as ContentHash,
    bytes: bytesFromBase64(opened.document.bytesBase64),
    sealedAt: opened.document.sealedAt,
  };

  mounted?.destroy();
  mounted = mountCeremony({
    handoff: opened.handoff,
    container,
    document: sealed,
    fileName: opened.fileName,
    language: "es",
    onEvent: (event) => {
      const failed = event.type === "lakaut.flow.failed";
      note(describeEvent(event), failed);
      if (failed) say(STATUS_LINES.failed);
      // The visual experience ending is a cue to read the record, not a conclusion.
      if (event.type === "lakaut.flow.completed" || failed) {
        void readStatus();
      }
    },
    onSigned: (delivery) => deliver(token, delivery),
  });

  say(STATUS_LINES.ready);
}

function boot(): void {
  start().catch((error: unknown) => {
    report(error);
    offerRetry(boot);
  });
}

boot();
