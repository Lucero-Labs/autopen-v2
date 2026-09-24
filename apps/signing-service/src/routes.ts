/**
 * The service's HTTP surface, built from its dependencies rather than from the environment.
 *
 * The issuer's page (`/`) creates an instrument and gets a link; the signing
 * page (`/sign/{token}`) is what the link opens. The page makes one call, the
 * handoff, and the service decides the rest: nothing the signer's browser
 * sends chooses a journey (`sdk-integracion__seguridad.md`, "Protección de
 * endpoints propios"). Products reach the instrument routes with one API key
 * as a bearer token; the pages and the webhook carry their own credentials.
 * Everything the router cannot determine arrives as a parameter, so the whole
 * surface runs in a test against a fake provider (STYLES §10).
 */

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import {
  type CeremonyHandoff,
  type CeremonyId,
  type CeremonyLedger,
  type CeremonyPlan,
  type CeremonyStatus,
  type ContentHash,
  deriveDocumentId,
  type DocumentId,
  type DocumentStore,
  looksLikePdf,
  type SealedDocument,
  sha256,
  type SignedDelivery,
  type SigningCore,
} from "@autopen/core";
import {
  answerWebhookChallenge,
  type CeremonyNotification,
  isWebhookChallenge,
  LAKAUT_MAX_DOCUMENT_BYTES,
  readCeremonyNotification,
  type SigningEligibility,
  type WebhookChallengeReply,
} from "@autopen/adapter-lakaut";

import type { EvidenceStore } from "./evidence.ts";
import type { DatabaseProbe } from "./health.ts";
import type { Instrument, InstrumentIds, InstrumentStore } from "./instruments.ts";
import type {
  DatabaseReachability,
  DeliveryResponse,
  ErrorResponse,
  HandoffResponse,
  HealthResponse,
  InstrumentResponse,
  SigningStatus,
  StatusResponse,
} from "./wire.ts";

/** The one free read the router makes before opening anything (AGENTS.md, "Vendor access"). */
export type EligibilityCheck = (subject: {
  readonly email: string;
  readonly externalUserRef: string;
}) => Promise<SigningEligibility>;

/** Everything the router needs and cannot decide for itself. */
export interface RouterDependencies {
  readonly core: SigningCore;
  readonly checkEligibility: EligibilityCheck;
  readonly instruments: InstrumentStore;
  /** Read back for the handoff; sealing itself goes through `core`. */
  readonly documents: DocumentStore;
  /** For webhook idempotency only; ceremonies themselves go through `core`. */
  readonly ceremonies: CeremonyLedger;
  /** The custody sink, run before the binding (§9.5); also serves the artefact. */
  readonly evidence: EvidenceStore;
  readonly ids: InstrumentIds;
  /** Required, as `Authorization: Bearer <key>`, on every product-facing route. Never logged. */
  readonly apiKey: string;
  /** Reported by `/health` so a deployment says which Lakaut environment it talks to. */
  readonly environment: string;
  /** Reported by `/health`; the probe, not the URL, so the router never holds a database credential. */
  readonly database: DatabaseProbe;
  /** The clock the health probe's window is measured on; injected so a test can move it. */
  readonly now: () => Date;
  /** The origin the signing link is minted under. Also the session's `allowedOrigin`. */
  readonly allowedOrigin: string;
  /** Allow-listed by the signing page's CSP; every handoff is checked against it. */
  readonly hostedUiOrigin: string;
  /** `undefined` until a destination is saved in the dashboard. The webhook route then answers 503. */
  readonly webhookSecret: string | undefined;
  /** The directory `index.html`, `sign.html` and the two bundles are served from. */
  readonly webRoot: string;
}

/** The largest body accepted: the provider's PDF ceiling, base64-expanded, plus room for the other fields. */
const MAX_BODY_BYTES: number = Math.ceil((LAKAUT_MAX_DOCUMENT_BYTES * 4) / 3) + 64 * 1024;

/** The vendor's cap on `fileName` (`sdk-integracion__documentos-firma.md`, "Validaciones del documento"). */
const MAX_FILE_NAME_CHARS = 180;

/**
 * How long one database probe answers for: `/health` is unauthenticated, so
 * without a window every anonymous request would open a connection.
 */
const HEALTH_PROBE_WINDOW_MS = 10_000;

/** Canonical RFC 4648 base64, padding included; the decoder is lenient, so this comes first. */
const BASE64_SHAPE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * What `POST /api/instruments` accepts, decoded: the product's finished PDF, its
 * name, and who signs. The journey and factors are not the product's to choose.
 */
interface CreateInstrumentRequest {
  readonly reference: string;
  readonly fileName: string;
  readonly bytes: Uint8Array;
  readonly signer: Instrument["signer"];
}

interface DeliveryRequest {
  readonly ceremonyId: string;
  readonly documentId: string;
  readonly fileName: string;
  readonly bytesBase64: string;
  readonly signedContentHash: string;
  readonly finalPdfHash: string;
  readonly signedAt: string;
}

/** What a product asks for under `/api/instruments/{id}`: the record, the sealed PDF, or the signed one. */
type InstrumentPart = "instrument" | "document" | "artifact";

/**
 * A refusal with the status it deserves, as opposed to a bug, which is a 500.
 * Extends `Error`, not `CoreError`: it belongs to this surface, and its message
 * is written to be shown to the caller.
 */
class RefusedError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
  }
}

/** An error's message, or a stand-in. Never the value itself, which may carry bytes. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown failure";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The provider's `correlationId` at any depth of `cause`: the one handle vendor support can trace (§8.1). */
function correlationIdOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && isObject(current); depth += 1) {
    const candidate = current.correlationId;
    if (typeof candidate === "string" && candidate !== "") return candidate;
    current = current.cause;
  }
  return undefined;
}

/** The string under `key`, or a 400 naming it as `label`: the dotted path when nested. */
function readString(source: Record<string, unknown>, key: string, label: string = key): string {
  const value = source[key];
  if (typeof value !== "string" || value === "") {
    throw new RefusedError(400, `${label} must be a non-empty string`);
  }
  return value;
}

/** A `fileName` within the vendor's cap; both routes that carry one read it here. */
function readFileName(source: Record<string, unknown>): string {
  const fileName = readString(source, "fileName");
  if (fileName.length > MAX_FILE_NAME_CHARS) {
    throw new RefusedError(400, `fileName must be at most ${MAX_FILE_NAME_CHARS} characters`);
  }
  return fileName;
}

/**
 * The PDF a product sent, decoded from `pdfBase64`, or the refusal it earns.
 *
 * Node's decoder skips what is not base64 rather than throwing, so a string
 * that merely starts well would decode to a plausible header; the shape is
 * checked before anything is decoded. The exact size check is here too:
 * `MAX_BODY_BYTES` catches gross oversize before buffering, but only the
 * decoded length says whether the provider will take the file.
 */
function readPdf(source: Record<string, unknown>): Uint8Array {
  const encoded = readString(source, "pdfBase64");
  if (!BASE64_SHAPE.test(encoded) || encoded.length % 4 !== 0) {
    throw new RefusedError(400, "pdfBase64 must be base64");
  }
  const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
  if (!looksLikePdf(bytes)) {
    throw new RefusedError(400, "pdfBase64 must be a PDF: no %PDF- header");
  }
  if (bytes.byteLength > LAKAUT_MAX_DOCUMENT_BYTES) {
    throw new RefusedError(
      413,
      `pdfBase64 must decode to at most ${LAKAUT_MAX_DOCUMENT_BYTES} bytes`,
    );
  }
  return bytes;
}

function toCreateInstrumentRequest(body: unknown): CreateInstrumentRequest {
  if (!isObject(body)) throw new RefusedError(400, "body must be an object");

  const fileName = readFileName(body);
  // The delivery route takes the provider's artefact name as it comes; this one
  // is ours to constrain, and it is what the signer downloads.
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    throw new RefusedError(400, "fileName must end with .pdf");
  }

  const signer = body.signer;
  if (!isObject(signer)) throw new RefusedError(400, "signer must be an object");
  const phone = signer.phone;
  if (phone !== undefined && typeof phone !== "string") {
    throw new RefusedError(400, "signer.phone must be a non-empty string");
  }

  return {
    reference: readString(body, "reference"),
    fileName,
    bytes: readPdf(body),
    signer: Object.freeze({
      email: readString(signer, "email", "signer.email"),
      // A blank is absent: the harness posts its empty field as "".
      ...(phone !== undefined && phone !== "" ? { phone } : {}),
    }),
  };
}

/** Whether two signers are the same person by the fields the ceremony is opened with. */
function sameSigner(a: Instrument["signer"], b: Instrument["signer"]): boolean {
  return a.email === b.email && a.phone === b.phone;
}

function toDeliveryRequest(body: unknown): DeliveryRequest {
  if (!isObject(body)) throw new RefusedError(400, "body must be an object");
  return {
    ceremonyId: readString(body, "ceremonyId"),
    documentId: readString(body, "documentId"),
    fileName: readFileName(body),
    bytesBase64: readString(body, "bytesBase64"),
    signedContentHash: readString(body, "signedContentHash"),
    finalPdfHash: readString(body, "finalPdfHash"),
    signedAt: readString(body, "signedAt"),
  };
}

/**
 * The link token, wherever it appears in a path, replaced by an ellipsis;
 * every logged path goes through here (§8.1).
 */
function redactPath(pathname: string): string {
  return pathname.replace(/^(\/(?:api\/)?sign)\/[^/]+/, "$1/…");
}

/** The request's path without its query string, for a log line; the host is irrelevant to it. */
function pathnameOf(request: IncomingMessage): string {
  return new URL(request.url ?? "/", "http://localhost").pathname;
}

/** The token between `/api/sign/` and the action, or `undefined` for any other path. */
function signRoute(
  pathname: string,
): { readonly token: string; readonly action: string } | undefined {
  const match = /^\/api\/sign\/([^/]+)\/(handoff|status|deliveries)$/.exec(pathname);
  if (match === null) return undefined;
  const token = match[1];
  const action = match[2];
  if (token === undefined || action === undefined) return undefined;
  return { token, action };
}

/** The id and part of a `/api/instruments/{id}[/document|/artifact]` path, or `undefined` for any other. */
function instrumentRoute(
  pathname: string,
): { readonly instrumentId: string; readonly part: InstrumentPart } | undefined {
  const match = /^\/api\/instruments\/([^/]+)(?:\/(document|artifact))?$/.exec(pathname);
  if (match === null) return undefined;
  const instrumentId = match[1];
  if (instrumentId === undefined) return undefined;
  const part = match[2];
  return { instrumentId, part: part === "document" || part === "artifact" ? part : "instrument" };
}

/**
 * Whether the request carries the product API key as `Authorization: Bearer <key>`.
 *
 * `timingSafeEqual` throws on unequal lengths, so the length check is what
 * keeps a wrong key of the wrong length from being a 500.
 */
function presentsApiKey(request: IncomingMessage, apiKey: string): boolean {
  const header = request.headers.authorization;
  if (typeof header !== "string") return false;
  const presented = /^Bearer (\S+)$/.exec(header)?.[1];
  if (presented === undefined) return false;
  const expected = Buffer.from(apiKey);
  const given = Buffer.from(presented);
  return given.byteLength === expected.byteLength && timingSafeEqual(given, expected);
}

/**
 * The raw body, or a 413 once it is known to exceed `MAX_BODY_BYTES`.
 *
 * Past the limit the stream is drained rather than destroyed, so the client
 * reads the 413 instead of a reset socket.
 */
function readRaw(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tooLarge = new RefusedError(413, `body must be at most ${MAX_BODY_BYTES} bytes`);
    let refused = false;
    const refuse = (): void => {
      refused = true;
      request.resume();
      reject(tooLarge);
    };

    const declared = Number(request.headers["content-length"] ?? "0");
    if (declared > MAX_BODY_BYTES) {
      refuse();
      return;
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    request.on("data", (chunk: Uint8Array) => {
      if (refused) return;
      received += chunk.byteLength;
      if (received > MAX_BODY_BYTES) {
        refuse();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      if (!refused) resolve(Buffer.concat(chunks));
    });
  });
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const raw = await readRaw(request);
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new RefusedError(400, "body must be JSON");
  }
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response
    .writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      // Nothing on this surface may be served from a cache
      // (`sdk-integracion__seguridad.md`, "Protección de endpoints propios").
      "cache-control": "no-store",
    })
    .end(JSON.stringify(payload));
}

/** A PDF, whole, with the same no-cache rule as every other answer here. */
function pdf(response: ServerResponse, bytes: Uint8Array): void {
  response
    .writeHead(200, {
      "content-type": "application/pdf",
      "content-length": String(bytes.byteLength),
      "cache-control": "no-store",
    })
    .end(bytes);
}

/**
 * Runs `start` once per `key` at a time; a concurrent caller awaits the first.
 *
 * Session idempotency is ours: the provider's `idempotencyKey` compiles,
 * validates and is discarded (STYLES §9.6). The entry is cleared when settled,
 * so a failure can be retried and a success is then answered from the store.
 */
function singleFlight<T>(
  inFlight: Map<string, Promise<T>>,
  key: string,
  start: () => Promise<T>,
): Promise<T> {
  const pending = inFlight.get(key);
  if (pending !== undefined) return pending;
  const started = start().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, started);
  return started;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
});

/** The files the browser may ask for by name. Anything else is 404, so there is no traversal. */
const STATIC_FILES: ReadonlySet<string> = new Set(["index.html", "client.js", "sign.js"]);

/**
 * The headers the signing page needs and the issuer's page must not carry.
 *
 * Both allow-lists are quoted from `sdk-integracion__seguridad.md`: `frame-src`
 * and `child-src` from "Content Security Policy", camera and microphone from
 * "Permissions Policy". No further directive is added: one the vendor did not
 * ask for cannot be verified without a live ceremony. `Referrer-Policy:
 * no-referrer` is ours: the token is the URL.
 */
function signingPageHeaders(hostedUiOrigin: string): Readonly<Record<string, string>> {
  return Object.freeze({
    "content-type": CONTENT_TYPES[".html"] ?? "text/plain",
    "cache-control": "no-store",
    "content-security-policy":
      `frame-src 'self' ${hostedUiOrigin}; ` + `child-src 'self' ${hostedUiOrigin}`,
    "permissions-policy":
      `camera=(self "${hostedUiOrigin}"), ` + `microphone=(self "${hostedUiOrigin}")`,
    "referrer-policy": "no-referrer",
  });
}

/** `open` stays open; `completed` at the provider is not `signed` here (STYLES §9.1). */
function toSigningStatus(status: CeremonyStatus): SigningStatus {
  switch (status.state) {
    case "open":
      return "awaiting-signature";
    case "completed":
      return "awaiting-delivery";
    case "cancelled":
    case "expired":
    case "failed":
      return status.state;
  }
}

/** The reconciled ceremony, restated for a page. */
function toStatusResponse(reconciled: CeremonyStatus): StatusResponse {
  return Object.freeze({
    state: toSigningStatus(reconciled),
    ceremony: Object.freeze({
      state: reconciled.state,
      ...(reconciled.errorCode !== undefined ? { errorCode: reconciled.errorCode } : {}),
      ...(reconciled.disposition !== undefined ? { disposition: reconciled.disposition } : {}),
      correlationId: reconciled.correlationId,
    }),
  });
}

/** Nothing to mount, nothing to reconcile: the state alone. */
function bare(state: SigningStatus): StatusResponse {
  return Object.freeze({ state });
}

/**
 * The plan the eligibility read implies, or a refusal when it implies none.
 *
 * `journey.onboarding-signing.v1` admits `auth.email-sms.v1` only, while
 * `journey.signing.v1` admits all three profiles (`sdk-integracion__agentes.md`),
 * so onboarding is `email-and-sms` and signing takes the lightest, `email`. A
 * read that recommends no journey opens nothing: guessing spends an OTP to
 * reach a wall (STYLES §0.1).
 */
function planFor(eligibility: SigningEligibility, signer: Instrument["signer"]): CeremonyPlan {
  if (eligibility.journey === "signing") {
    return Object.freeze({ journey: "signing", factors: "email" });
  }

  if (eligibility.journey === "onboarding-and-signing") {
    if (signer.phone === undefined) {
      throw new RefusedError(
        409,
        "the signer holds no certificate, and onboarding needs a phone: " +
          "create the instrument again under a new reference, with a phone",
      );
    }
    return Object.freeze({ journey: "onboarding-and-signing", factors: "email-and-sms" });
  }

  throw new RefusedError(
    409,
    `the provider recommends no journey yet (${eligibility.decision})` +
      (eligibility.retryAfterSeconds !== undefined
        ? `; retry in ${eligibility.retryAfterSeconds}s`
        : ""),
  );
}

/** The router as a request listener: routing, refusals and the one error log line. */
export function createRouter(deps: RouterDependencies): RequestListener {
  const { core, instruments, ceremonies } = deps;
  const creating = new Map<string, Promise<{ status: number; instrument: Instrument }>>();
  const handingOff = new Map<string, Promise<HandoffResponse | StatusResponse>>();
  let lastProbe:
    | { readonly at: number; readonly result: Promise<DatabaseReachability> }
    | undefined;

  /**
   * Refuses a handoff whose Hosted UI origin is not the one the page allows.
   *
   * The vendor asks that every session be validated against the configured
   * allowlist (`sdk-integracion__seguridad.md`, "Content Security Policy"); a
   * mismatch would otherwise surface as an iframe the page's CSP refuses to
   * load, with nothing in any log to say why.
   */
  function assertHostedUiOrigin(handoff: CeremonyHandoff): void {
    const issued = handoff.context.hostedUiOrigin;
    if (issued !== deps.hostedUiOrigin) {
      throw new Error(
        `the session's Hosted UI origin is ${typeof issued === "string" ? issued : "absent"} ` +
          `but LAKAUT_HOSTED_UI_ORIGIN is ${deps.hostedUiOrigin}`,
      );
    }
  }

  async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
    if (pathname.startsWith("/sign/")) {
      // An unknown token still gets the page, which then reports it cannot be opened.
      const body = await readFile(join(deps.webRoot, "sign.html"));
      response.writeHead(200, signingPageHeaders(deps.hostedUiOrigin)).end(body);
      return;
    }

    const name = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!STATIC_FILES.has(name)) {
      response.writeHead(404).end("not found");
      return;
    }

    const body = await readFile(join(deps.webRoot, name));
    response
      .writeHead(200, {
        "content-type": CONTENT_TYPES[extname(name)] ?? "text/plain",
        // A rebuilt bundle must reach the page on reload.
        "cache-control": "no-store",
      })
      .end(body);
  }

  /**
   * Seals the PDF the product sent and mints the link.
   *
   * Idempotent on `reference`: the same bytes and the same signer return the
   * existing instrument. Different bytes are refused — a reference names one
   * document (STYLES §9.2) — and so is a different signer, because the
   * ceremony opens for whoever the instrument stored and a 200 would hide the
   * swap. The `fileName` is not part of that identity: the first one is kept.
   *
   * The id is derived before the single flight and compared after it, so a
   * concurrent create with different bytes shares the flight and still gets
   * its 409 rather than the other caller's instrument.
   */
  async function createInstrument(
    request: CreateInstrumentRequest,
  ): Promise<{ readonly status: number; readonly instrument: Instrument }> {
    const documentId = await deriveDocumentId(request.reference, await sha256(request.bytes));

    const result = await singleFlight(creating, request.reference, async () => {
      const existing = await instruments.findByReference(request.reference);
      if (existing !== undefined) return { status: 200, instrument: existing };

      const sealed = await core.seal(request.bytes, request.reference);
      const instrument: Instrument = Object.freeze({
        instrumentId: deps.ids.instrumentId(),
        token: deps.ids.token(),
        reference: request.reference,
        fileName: request.fileName,
        documentId: sealed.documentId,
        signer: request.signer,
        state: "awaiting-signature",
      });
      await instruments.put(instrument);

      console.log(
        `instrument created instrumentId=${instrument.instrumentId} ` +
          `documentId=${instrument.documentId} reference=${instrument.reference}`,
      );

      return { status: 201, instrument };
    });

    if (result.instrument.documentId !== documentId) {
      throw new RefusedError(
        409,
        `reference ${request.reference} already names a different document`,
      );
    }
    if (!sameSigner(result.instrument.signer, request.signer)) {
      throw new RefusedError(
        409,
        `reference ${request.reference} already names a different signer`,
      );
    }
    return result;
  }

  function toInstrumentResponse(instrument: Instrument): InstrumentResponse {
    return Object.freeze({
      instrumentId: instrument.instrumentId,
      reference: instrument.reference,
      documentId: instrument.documentId,
      state: instrument.state,
      signingUrl: `${deps.allowedOrigin}/sign/${instrument.token}`,
    });
  }

  /** The instrument a product asked for by id, or a 404 that says no more than that. */
  async function findInstrument(instrumentId: string): Promise<Instrument> {
    const instrument = await instruments.findById(instrumentId);
    if (instrument === undefined) throw new RefusedError(404, "no such instrument");
    return instrument;
  }

  /** The sealed, unsigned document: what the signing page mounts and `/document` serves. */
  async function sealedDocument(instrument: Instrument): Promise<SealedDocument> {
    const sealed = await deps.documents.get(instrument.documentId);
    if (sealed === undefined) {
      // Stored only after its seal: a missing document is a store bug, not a caller state.
      throw new Error(`document ${instrument.documentId} is not sealed`);
    }
    return sealed;
  }

  /**
   * The signed PDF, once there is one.
   *
   * `signed` is written only after custody, so a signed instrument whose copy
   * cannot be read is a broken store: a 500, never a 404 that reads as "not yet".
   */
  async function signedBytes(instrument: Instrument): Promise<Uint8Array> {
    if (instrument.state !== "signed") throw new RefusedError(404, "not signed yet");
    const bytes = await deps.evidence.readArtifact(instrument.documentId);
    if (bytes === undefined) {
      throw new Error(
        `instrument ${instrument.instrumentId} is signed but document ` +
          `${instrument.documentId} is not in custody`,
      );
    }
    return bytes;
  }

  /**
   * The database probe's answer, reused within `HEALTH_PROBE_WINDOW_MS`. The
   * promise is cached, not the value, so concurrent requests share one socket.
   */
  function databaseReachability(): Promise<DatabaseReachability> {
    const at = deps.now().getTime();
    if (lastProbe !== undefined && at - lastProbe.at < HEALTH_PROBE_WINDOW_MS) {
      return lastProbe.result;
    }
    const result = deps.database();
    lastProbe = { at, result };
    return result;
  }

  /** What an unauthenticated caller may know. */
  async function health(): Promise<HealthResponse> {
    return Object.freeze({
      ok: true as const,
      environment: deps.environment,
      database: await databaseReachability(),
    });
  }

  /** Opens the ceremony for an instrument that has none, and stores it. */
  async function openFor(instrument: Instrument): Promise<NonNullable<Instrument["ceremony"]>> {
    const eligibility = await deps.checkEligibility({
      email: instrument.signer.email,
      externalUserRef: instrument.reference,
    });
    const plan = planFor(eligibility, instrument.signer);

    const opened = await core.openCeremony(
      instrument.documentId,
      {
        role: "librador",
        email: instrument.signer.email,
        externalUserRef: instrument.reference,
        ...(instrument.signer.phone !== undefined ? { phone: instrument.signer.phone } : {}),
      },
      plan,
    );
    const ceremony = Object.freeze({ ceremonyId: opened.ceremonyId, handoff: opened.handoff });
    await instruments.put(Object.freeze({ ...instrument, ceremony }));

    console.log(
      `opened  journey=${plan.journey} factors=${plan.factors} ` +
        `sessionId=${ceremony.ceremonyId} documentId=${instrument.documentId} ` +
        `instrumentId=${instrument.instrumentId}`,
    );
    return ceremony;
  }

  /**
   * Opens the ceremony on first contact and returns what the page mounts, or says why there is nothing to.
   *
   * An existing ceremony is reconciled first: cancelled, expired or failed gets
   * the state and no handoff; `open`, or `completed` with no copy in custody
   * yet, gets the stored handoff again as-is. Known gap: that handoff's client
   * token may have expired or been consumed since, and nothing here can tell.
   * The page reports the SDK's lifecycle event instead of opening a second
   * session; server-side recovery is a later change.
   */
  function handoff(instrument: Instrument): Promise<HandoffResponse | StatusResponse> {
    return singleFlight(handingOff, instrument.token, async () => {
      if (instrument.state === "signed") return bare("signed");

      let ceremony = instrument.ceremony;
      if (ceremony !== undefined) {
        const reconciled = await core.reconcile(ceremony.ceremonyId);
        if (
          reconciled.state === "cancelled" ||
          reconciled.state === "expired" ||
          reconciled.state === "failed"
        ) {
          return toStatusResponse(reconciled);
        }
      } else {
        ceremony = await openFor(instrument);
      }

      assertHostedUiOrigin(ceremony.handoff);

      const sealed = await sealedDocument(instrument);

      return Object.freeze({
        state: "awaiting-signature",
        // Exactly what the provider produced, never hand-built (§8.2).
        handoff: ceremony.handoff,
        ceremonyId: ceremony.ceremonyId,
        fileName: instrument.fileName,
        document: Object.freeze({
          documentId: sealed.documentId,
          contentHash: sealed.contentHash,
          bytesBase64: Buffer.from(sealed.bytes).toString("base64"),
          sealedAt: sealed.sealedAt,
        }),
      });
    });
  }

  /** The instrument's state, read from the provider when a ceremony exists. */
  async function status(instrument: Instrument): Promise<StatusResponse> {
    if (instrument.state === "signed") return bare("signed");
    if (instrument.ceremony === undefined) return bare("awaiting-signature");
    return toStatusResponse(await core.reconcile(instrument.ceremony.ceremonyId));
  }

  /**
   * Verifies the delivered copy, archives it, and only then marks the instrument signed.
   *
   * The link token chose the instrument; the body must name that instrument's
   * ceremony and document, so a body cannot steer a copy onto a ceremony the
   * link does not own. The custody sink runs inside `ingest`, before the
   * binding (STYLES §9.5); the state change comes after both.
   */
  async function ingestDelivery(
    instrument: Instrument,
    request: DeliveryRequest,
  ): Promise<DeliveryResponse> {
    if (
      instrument.ceremony === undefined ||
      instrument.ceremony.ceremonyId !== request.ceremonyId
    ) {
      throw new RefusedError(
        409,
        `ceremony ${request.ceremonyId} does not belong to this instrument`,
      );
    }
    if (instrument.documentId !== request.documentId) {
      throw new RefusedError(
        409,
        `ceremony ${request.ceremonyId} was opened for document ${instrument.documentId}, ` +
          `not ${request.documentId}`,
      );
    }

    const delivery: SignedDelivery = {
      ceremonyId: request.ceremonyId as CeremonyId,
      documentId: request.documentId as DocumentId,
      fileName: request.fileName,
      bytes: new Uint8Array(Buffer.from(request.bytesBase64, "base64")),
      signedContentHash: request.signedContentHash as ContentHash,
      finalPdfHash: request.finalPdfHash as ContentHash,
      signedAt: request.signedAt,
    };

    const verified = await core.ingest(delivery, (artifact) => deps.evidence.archive(artifact));
    await instruments.put(Object.freeze({ ...instrument, state: "signed" }));

    console.log(
      `ingested documentId=${verified.documentId} instrumentId=${instrument.instrumentId} ` +
        `verifiedAt=${verified.verifiedAt}`,
    );

    return Object.freeze({
      documentId: verified.documentId,
      verifiedAt: verified.verifiedAt,
    });
  }

  /**
   * Answers the challenge, then verified events, on one URL.
   *
   * Takes the raw bytes and never re-serialises them: the HMAC covers exactly
   * what arrived. Handling is idempotent on `idempotencyKey` because webhooks
   * repeat (STYLES §9.1).
   */
  async function handleWebhook(
    request: IncomingMessage,
    response: ServerResponse,
    raw: Buffer,
  ): Promise<void> {
    if (deps.webhookSecret === undefined) {
      // Fail closed: an unverifiable delivery is never acknowledged (§0.1).
      console.error("webhook rejected: LAKAUT_WEBHOOK_SECRET is unset");
      response.writeHead(503).end("webhook secret not configured");
      return;
    }

    if (isWebhookChallenge(raw)) {
      // 401, not 500: a delivery that fails to verify is rejected, not mishandled.
      let reply: WebhookChallengeReply;
      try {
        reply = answerWebhookChallenge(raw, request.headers, deps.webhookSecret);
      } catch (error) {
        console.error(`webhook challenge refused: ${describe(error)}`);
        response.writeHead(401).end("challenge did not verify");
        return;
      }
      console.log(`webhook challenge verified challengeId=${reply.challengeId}`);
      json(response, 200, reply);
      return;
    }

    let event: CeremonyNotification;
    try {
      event = readCeremonyNotification(raw, request.headers, deps.webhookSecret);
    } catch (error) {
      console.error(`webhook event refused: ${describe(error)}`);
      response.writeHead(401).end("event did not verify");
      return;
    }

    if (await ceremonies.hasApplied(event.idempotencyKey)) {
      console.log(`webhook repeat ignored type=${event.type} key=${event.idempotencyKey}`);
      json(response, 200, { status: "already applied" });
      return;
    }
    await ceremonies.markApplied(event.idempotencyKey);

    // `data` is where a failure states its own reason; the session read reports
    // errorCode null for a failed step. No PIN, OTP, DNI or bytes travel in an envelope.
    console.log(
      `webhook ${event.type} v${event.version} sessionId=${event.ceremonyId} ` +
        `finalStatus=${event.finalStatus ?? "-"} correlationId=${event.correlationId} ` +
        `data=${JSON.stringify(event.data)}`,
    );

    json(response, 200, { status: "applied" });
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, await health());
      return;
    }

    if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
      await serveStatic(url.pathname, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/webhooks/lakaut") {
      await handleWebhook(request, response, await readRaw(request));
      return;
    }

    const sign = signRoute(url.pathname);
    if (sign !== undefined) {
      const instrument = await instruments.findByToken(sign.token);
      if (instrument === undefined) {
        // No log line: the token is the credential (STYLES §8.1).
        json(response, 404, { error: "no such instrument" } satisfies ErrorResponse);
        return;
      }
      if (request.method === "POST" && sign.action === "handoff") {
        json(response, 200, await handoff(instrument));
        return;
      }
      if (request.method === "GET" && sign.action === "status") {
        json(response, 200, await status(instrument));
        return;
      }
      if (request.method === "POST" && sign.action === "deliveries") {
        const delivery = toDeliveryRequest(await readBody(request));
        json(response, 200, await ingestDelivery(instrument, delivery));
        return;
      }
      // Answered here, not by the key gate below: the token was valid, so 401 would be a lie.
      json(response, 405, { error: "method not allowed" } satisfies ErrorResponse);
      return;
    }

    // Everything left under `/api/` is product-facing, refused before any body is read.
    if (!presentsApiKey(request, deps.apiKey)) {
      console.error(`401 ${request.method} ${redactPath(url.pathname)}`);
      request.resume();
      json(response, 401, { error: "unauthorized" } satisfies ErrorResponse);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/eligibility") {
      const body = await readBody(request);
      if (!isObject(body)) throw new RefusedError(400, "body must be an object");
      const reference = readString(body, "reference");
      try {
        json(
          response,
          200,
          await deps.checkEligibility({
            email: readString(body, "email"),
            externalUserRef: reference,
          }),
        );
      } catch (error) {
        // The reference is safe to log, the email is not (STYLES §8.1). A reused
        // reference is the documented cause of a bare INVALID_REQUEST here.
        console.error(`eligibility failed for reference=${reference}: ${describe(error)}`);
        throw error;
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/instruments") {
      const created = await createInstrument(toCreateInstrumentRequest(await readBody(request)));
      json(response, created.status, toInstrumentResponse(created.instrument));
      return;
    }

    const product = instrumentRoute(url.pathname);
    if (request.method === "GET" && product !== undefined) {
      const instrument = await findInstrument(product.instrumentId);
      switch (product.part) {
        case "instrument":
          json(response, 200, toInstrumentResponse(instrument));
          return;
        case "document":
          pdf(response, (await sealedDocument(instrument)).bytes);
          return;
        case "artifact":
          pdf(response, await signedBytes(instrument));
          return;
      }
    }

    json(response, 404, { error: "no such route" } satisfies ErrorResponse);
  }

  return (request, response) => {
    route(request, response).catch((error: unknown) => {
      const message = describe(error);
      const status = error instanceof RefusedError ? error.status : 500;
      console.error(`${request.method} ${redactPath(pathnameOf(request))} -> ${status} ${message}`);
      if (response.headersSent) return;

      // A refusal explains itself. A failure's message may name a path, a
      // configured value or a core internal, none of which the caller should read.
      const correlationId = status === 500 ? correlationIdOf(error) : undefined;
      const body: ErrorResponse = Object.freeze({
        error: status === 500 ? "error interno" : message,
        ...(correlationId !== undefined ? { correlationId } : {}),
      });
      json(response, status, body);
    });
  };
}
