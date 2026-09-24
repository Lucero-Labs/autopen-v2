/**
 * The demo's HTTP surface, built from its dependencies rather than from the
 * environment.
 *
 * Two pages sit on it. The issuer's page (`/`) creates an instrument and gets a
 * link; the signing page (`/sign/{token}`) is what the link opens. The page
 * makes one call, the handoff, and the service decides the rest: whether the
 * signer already holds a certificate, which journey that implies, and which
 * factors that journey allows. Nothing the signer's browser sends chooses a
 * journey (`sdk-integracion__seguridad.md`, "Protección de endpoints propios").
 *
 * A product reaches the instrument routes with one API key, sent as a bearer
 * token. The pages and the webhook carry their own credentials — the link
 * token, the HMAC — and need no key. The key is a backend secret: a product
 * that uses it from a browser has leaked it.
 *
 * Everything the router cannot determine — the core, the eligibility read, the
 * evidence store, the identifiers, the key — arrives as a parameter, so the
 * whole surface runs in a test against a fake provider (STYLES §10).
 * `server.ts` is the only place that reads the environment.
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
import { renderPagare } from "./pagare.ts";
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
  /** Archives between verification and binding — rejecting cancels the binding (§9.5) — and serves the artefact. */
  readonly evidence: EvidenceStore;
  readonly ids: InstrumentIds;
  /** Required, as `Authorization: Bearer <key>`, on every product-facing route. Never logged. */
  readonly apiKey: string;
  /** Reported by `/health` so a deployment says which Lakaut environment it talks to. */
  readonly environment: string;
  /** Reported by `/health`; the probe, not the URL, so the router never holds a database credential. */
  readonly database: DatabaseProbe;
  /** The clock the health probe's window is measured on. Injected so a test can move it (STYLES §4). */
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

/**
 * The largest request body accepted, in bytes.
 *
 * A delivery carries the signed PDF as base64 inside JSON: the provider's own
 * PDF ceiling, times four thirds for the encoding, plus room for the other
 * fields. Anything larger is refused before it is buffered.
 */
const MAX_BODY_BYTES: number = Math.ceil((LAKAUT_MAX_DOCUMENT_BYTES * 4) / 3) + 64 * 1024;

/** The vendor's cap on `fileName` (`sdk-integracion__documentos-firma.md`, "Validaciones del documento"). */
const MAX_FILE_NAME_CHARS = 180;

/**
 * How long one database probe answers for.
 *
 * `/health` is unauthenticated, so without a window every anonymous request
 * would open a connection to the database host. Ten seconds is shorter than
 * any platform's check interval and long enough that a burst costs one probe.
 */
const HEALTH_PROBE_WINDOW_MS = 10_000;

/** What `POST /api/instruments` accepts. The journey and factors are not the issuer's to choose. */
interface CreateInstrumentRequest {
  readonly email: string;
  readonly phone?: string;
  readonly reference: string;
  readonly montoCentavos: number;
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
 *
 * An HTTP refusal, not a domain error: it extends `Error` rather than
 * `CoreError` because it belongs to this surface, and its message is written
 * to be shown to the caller.
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

/**
 * The provider's `correlationId` when a failure carries one, at any depth of `cause`.
 *
 * It is the only handle vendor support can trace (STYLES §8.1), so a 500 may
 * name it. Nothing else about the failure reaches the caller.
 */
function correlationIdOf(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && isObject(current); depth += 1) {
    const candidate = current.correlationId;
    if (typeof candidate === "string" && candidate !== "") return candidate;
    current = current.cause;
  }
  return undefined;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value === "") {
    throw new RefusedError(400, `${key} must be a non-empty string`);
  }
  return value;
}

function toCreateInstrumentRequest(body: unknown): CreateInstrumentRequest {
  if (!isObject(body)) throw new RefusedError(400, "body must be an object");

  const monto = body.montoCentavos;
  if (typeof monto !== "number" || !Number.isSafeInteger(monto) || monto <= 0) {
    throw new RefusedError(400, "montoCentavos must be a positive integer count of centavos");
  }

  const phone = body.phone;

  return {
    email: readString(body, "email"),
    reference: readString(body, "reference"),
    montoCentavos: monto,
    ...(typeof phone === "string" && phone !== "" ? { phone } : {}),
  };
}

function toDeliveryRequest(body: unknown): DeliveryRequest {
  if (!isObject(body)) throw new RefusedError(400, "body must be an object");
  const fileName = readString(body, "fileName");
  if (fileName.length > MAX_FILE_NAME_CHARS) {
    throw new RefusedError(400, `fileName must be at most ${MAX_FILE_NAME_CHARS} characters`);
  }
  return {
    ceremonyId: readString(body, "ceremonyId"),
    documentId: readString(body, "documentId"),
    fileName,
    bytesBase64: readString(body, "bytesBase64"),
    signedContentHash: readString(body, "signedContentHash"),
    finalPdfHash: readString(body, "finalPdfHash"),
    signedAt: readString(body, "signedAt"),
  };
}

/**
 * The link token, wherever it appears in a path, replaced by an ellipsis.
 *
 * Every log line that names a request goes through here. The token is the
 * signing credential, and `/sign/{token}` is the one place it is spelled out
 * in something a logger would otherwise print verbatim (STYLES §8.1).
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
 * Compared in constant time once the lengths agree, and refused outright when
 * they do not: `timingSafeEqual` throws on unequal lengths, so the length check
 * is what keeps a wrong key of the wrong length from being a 500. Nothing
 * about the presented value is kept or logged (STYLES §8.1).
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
 * Refused as early as the declared length allows, and otherwise the moment the
 * stream crosses the limit. From that point the stream is drained and
 * discarded rather than destroyed: an oversized upload is never buffered, and
 * the client still gets to read the 413 instead of a reset socket.
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
      // Handoffs and statuses are per signer and per moment. Nothing on this
      // surface may be served from a cache (`sdk-integracion__seguridad.md`,
      // "Protección de endpoints propios").
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
 * Session idempotency is ours to enforce — the provider's `idempotencyKey`
 * compiles, validates and is discarded (STYLES §9.6) — and so is instrument
 * idempotency. Two clicks on one link, or one reference posted twice in the
 * same instant, must produce one session and one instrument. The entry is
 * cleared when settled, so a failure can be retried and a success is then
 * answered from the store.
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
 * Both allow-list values are quoted from `sdk-integracion__seguridad.md`:
 * `frame-src` from "Content Security Policy", with `child-src` kept aligned
 * as that section asks, and the camera and microphone allowances from
 * "Permissions Policy". No further CSP directive is added: the page
 * recommends only these, and a directive the vendor did not ask for cannot be
 * verified here without a live ceremony — a wrong one would fail exactly like
 * a provider outage.
 *
 * `Referrer-Policy: no-referrer` is ours: the token is the URL, and a referrer
 * would carry it to whatever the page links to.
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
 * so onboarding is `email-and-sms` and signing takes the lightest, `email`.
 * A read that recommends no journey — `CERTIFICATE_PREPARING`, `RETRY_LATER` —
 * opens nothing: onboarding a signer whose certificate is being issued would
 * re-onboard them, and guessing `signing` spends an OTP to reach a wall
 * (STYLES §0.1).
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
          "create the instrument again with one",
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
   * The session's `hostedUiOrigin` is the authority for the contract, and the
   * vendor asks that every session be validated against the configured
   * allowlist rather than assumed (`sdk-integracion__seguridad.md`, "Content
   * Security Policy"). A mismatch here would otherwise surface as an iframe the
   * page's own CSP refuses to load, with nothing in any log to say why. The
   * message names both origins for the log; the caller gets a bare 500.
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
      // The page is the same for every token; the token is read by the page's
      // own script and checked by the handoff route. An unknown token still
      // gets a page, which then reports it cannot be opened.
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
        // A rebuilt bundle must reach the page on reload. A stale bundle is
        // indistinguishable from a fix that did not work.
        "cache-control": "no-store",
      })
      .end(body);
  }

  /**
   * Seals the stand-in pagaré and mints the link.
   *
   * Idempotent on `reference`: the same reference with the same bytes returns
   * the instrument that already exists, and the same reference with different
   * bytes is refused rather than silently re-linked — a reference names one
   * document (STYLES §9.2). Concurrent creates share one flight per reference.
   */
  function createInstrument(
    request: CreateInstrumentRequest,
  ): Promise<{ readonly status: number; readonly instrument: Instrument }> {
    return singleFlight(creating, request.reference, async () => {
      const bytes = renderPagare({
        reference: request.reference,
        montoCentavos: request.montoCentavos,
        librador: request.email,
        lugarDePago: "Ciudad Autónoma de Buenos Aires",
        vencimiento: "2027-09-11",
      });

      const existing = await instruments.findByReference(request.reference);
      if (existing !== undefined) {
        const documentId = await deriveDocumentId(request.reference, await sha256(bytes));
        if (documentId !== existing.documentId) {
          throw new RefusedError(
            409,
            `reference ${request.reference} already names a different document`,
          );
        }
        return { status: 200, instrument: existing };
      }

      const sealed = await core.seal(bytes, request.reference);
      const instrument: Instrument = Object.freeze({
        instrumentId: deps.ids.instrumentId(),
        token: deps.ids.token(),
        reference: request.reference,
        documentId: sealed.documentId,
        signer: Object.freeze({
          email: request.email,
          ...(request.phone !== undefined ? { phone: request.phone } : {}),
        }),
        state: "awaiting-signature",
      });
      await instruments.put(instrument);

      // Safe to log: the reference is ours, the ids are not credentials. The
      // token and the email are neither (STYLES §8.1).
      console.log(
        `instrument created instrumentId=${instrument.instrumentId} ` +
          `documentId=${instrument.documentId} reference=${instrument.reference}`,
      );

      return { status: 201, instrument };
    });
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

  /** The sealed, unsigned PDF: what the signer is shown. */
  async function sealedBytes(instrument: Instrument): Promise<Uint8Array> {
    const sealed = await deps.documents.get(instrument.documentId);
    if (sealed === undefined) {
      // An instrument is only ever stored after its seal; losing the document
      // is a bug in the store, never a state the caller should reason about.
      throw new Error(`document ${instrument.documentId} is not sealed`);
    }
    return sealed.bytes;
  }

  /**
   * The signed PDF, once there is one.
   *
   * `signed` is written only after custody, so a signed instrument whose copy
   * cannot be read is a broken store, not a pending signature: a 500, never a
   * 404 that a product would read as "not yet".
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
   * The database probe's answer, reused within `HEALTH_PROBE_WINDOW_MS`.
   *
   * The promise is cached, not the value, so requests that arrive while the
   * first probe is still connecting share it rather than each opening a socket.
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

  /** What an unauthenticated caller may know: the process is up, which environment it is, and whether the database answers. */
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

    // Safe to log: no token, no handoff, no email, no bytes (STYLES §8.1).
    console.log(
      `opened  journey=${plan.journey} factors=${plan.factors} ` +
        `sessionId=${ceremony.ceremonyId} documentId=${instrument.documentId} ` +
        `instrumentId=${instrument.instrumentId}`,
    );
    return ceremony;
  }

  /**
   * Opens the ceremony on first contact and returns what the page mounts —
   * or, when there is nothing left to mount, says why.
   *
   * A ceremony that already exists is reconciled first, so a link opened after
   * the session was cancelled, expired or failed gets the state and no
   * handoff: the page says so and mounts nothing. A ceremony still `open`, or
   * `completed` with no copy in custody yet, gets the stored handoff again
   * as-is.
   *
   * Deferred, deliberately: that stored handoff's client token may have
   * expired or been consumed since it was issued, and neither the reconcile
   * nor this route can tell. The SDK's lifecycle event tells the page when the
   * handoff is no longer usable, and the page reports that rather than opening
   * a second session. Recovering a session server-side is a later change.
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

      const sealed = await deps.documents.get(instrument.documentId);
      if (sealed === undefined) {
        // An instrument is only ever stored after its seal; losing the document
        // is a bug in the store, never a state the page should reason about.
        throw new Error(`document ${instrument.documentId} is not sealed`);
      }

      return Object.freeze({
        state: "awaiting-signature",
        // Exactly what the provider produced for a renderer. Never hand-built (§8.2).
        handoff: ceremony.handoff,
        ceremonyId: ceremony.ceremonyId,
        fileName: `${instrument.reference.replaceAll("/", "-")}.pdf`,
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
   * Verifies the delivered copy, archives it, and only then marks the
   * instrument signed.
   *
   * The link token chose the instrument; the body must then name that
   * instrument's ceremony and document, or it is refused before the core sees
   * it. The core checks the same thing against the ledger and would throw;
   * here it is a 409 the caller can act on, and a body cannot steer a copy
   * onto a ceremony the link does not own.
   *
   * The custody sink runs inside `ingest`, before the binding (STYLES §9.5).
   * The state change here is after both, so `signed` is never observed for
   * an instrument whose copy is not in custody.
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
   * what arrived, so a parse-and-rebuild produces a different body and a failed
   * verification that looks like a wrong secret.
   *
   * Events are the only channel that closes an operation without a browser, and
   * the one that carries a failure's own reason — `auth.session.failed` arrives
   * with detail the session read does not expose. Handling is idempotent on
   * `idempotencyKey` because webhooks repeat (STYLES §9.1).
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
      // 401, not 500: a delivery that fails to verify is rejected, not mishandled,
      // and the distinction is what tells us whose bug it is.
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

    // `data` is where a failure states its own reason, and it is the reason this
    // endpoint exists: the session read reports errorCode null for a step that
    // failed. Safe to log — no PIN, OTP, DNI or bytes travel in an envelope.
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
        // Same answer whether the token never existed or the process forgot
        // it, and no log line: the token is the credential (STYLES §8.1).
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
      // A known signing route with the wrong verb is answered here, not by
      // the key gate below: the token was valid, so 401 would be a lie.
      json(response, 405, { error: "method not allowed" } satisfies ErrorResponse);
      return;
    }

    // Everything left under `/api/` is product-facing. Refused before any
    // body is read, with one word in the answer and only the route in the
    // log: a caller without the key learns that it needs one, and no more.
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
        // The reference is our own identifier and safe to log; the email is not
        // (STYLES §8.1). A reused reference is the documented cause of a bare
        // INVALID_REQUEST here, so naming it is the whole diagnosis.
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
          pdf(response, await sealedBytes(instrument));
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
      // The path is redacted before it is printed, and the query string is
      // not printed at all, as on the 401 line; the message may name an error
      // code or a configured origin, which is for this log and not for the
      // anonymous caller (§8.1).
      console.error(`${request.method} ${redactPath(pathnameOf(request))} -> ${status} ${message}`);
      if (response.headersSent) return;

      // A refusal explains itself. A failure does not: its message may name a
      // path, a configured value or a core internal, none of which the signer
      // should read. The correlation id is the one thing worth handing over.
      const correlationId = status === 500 ? correlationIdOf(error) : undefined;
      const body: ErrorResponse = Object.freeze({
        error: status === 500 ? "error interno" : message,
        ...(correlationId !== undefined ? { correlationId } : {}),
      });
      json(response, status, body);
    });
  };
}
