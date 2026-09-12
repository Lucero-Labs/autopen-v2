/**
 * A backend for exercising both signing journeys against preproduction.
 *
 * Deliberately the smallest thing that is still honest about the invariants it
 * demonstrates. It seals real bytes, opens a real ceremony, and reconciles
 * against the provider's own record rather than the browser's word for it
 * (STYLES §9.1). Everything it persists lives in memory or in a directory, so
 * restarting it forgets everything.
 *
 * What it is not: a product. There is no policy gate in front of the seal, no
 * durable store behind it, and no authentication of the caller. Anything here
 * that looks like a decision was made for the demo, not for the core — the
 * core's decisions are in `docs/design/signing-spine.md`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  type AuthenticationFactors,
  type CeremonyId,
  type CeremonyJourney,
  type ContentHash,
  DefaultSigningCore,
  type DocumentId,
  InMemoryCeremonyLedger,
  InMemoryDocumentStore,
  type SignedDelivery,
  type VerifiedArtifact,
} from "@autopen/core";
import {
  answerWebhookChallenge,
  type CeremonyNotification,
  createLakautProvider,
  isWebhookChallenge,
  LAKAUT_MAX_DOCUMENT_BYTES,
  type LakautEnvironment,
  readCeremonyNotification,
  type WebhookChallengeReply,
} from "@autopen/adapter-lakaut";

import { renderPagare } from "./pagare.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB = join(HERE, "..", "web");
const EVIDENCE = join(HERE, "..", "evidence");

/**
 * Reads one variable or refuses to start.
 *
 * Fail closed at boot rather than at the first ceremony: a missing origin
 * surfaces as `FORBIDDEN_ORIGIN` three steps later, which reads like a
 * dashboard problem (STYLES §0.1).
 */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is unset. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

/**
 * Refuses to start against an origin the Hosted UI cannot be framed by.
 *
 * `createSession` accepts whatever origin it is handed and validates it against
 * the dashboard, so a wrong value here does not fail until the iframe declines
 * to load — and the browser reports that as a bare "refused to connect". An
 * http origin never works: the ceremony needs camera access, which browsers
 * grant only over https (`sdk-integracion__frontend-hosted-ui.md`).
 */
function toOrigin(value: string): string {
  if (!value.startsWith("https://")) {
    throw new Error(
      `LAKAUT_ALLOWED_ORIGIN is "${value}". The Hosted UI needs an https origin ` +
        "declared in the dashboard — point it at your tunnel, not at localhost.",
    );
  }
  return value;
}

const ORIGIN = toOrigin(required("LAKAUT_ALLOWED_ORIGIN"));

/** Narrows the configured environment rather than trusting the string (§0.1). */
function toEnvironment(value: string): LakautEnvironment {
  if (value !== "local" && value !== "sandbox" && value !== "production") {
    throw new Error(`LAKAUT_ENVIRONMENT is "${value}"; expected local, sandbox or production`);
  }
  return value;
}

/**
 * Blank until a destination is saved in the dashboard, which is correct.
 *
 * Read once rather than per request: rotation is a deploy, not a reload, and a
 * value that can change under a running verifier is how a rotation silently
 * half-applies.
 */
const WEBHOOK_SECRET = process.env["LAKAUT_WEBHOOK_SECRET"] ?? "";

const ceremonies = new InMemoryCeremonyLedger();

const core = new DefaultSigningCore({
  provider: createLakautProvider({
    baseUrl: required("LAKAUT_AUTH_BASE_URL"),
    integratorId: required("LAKAUT_INTEGRATOR_ID"),
    apiKey: required("LAKAUT_API_KEY"),
    environment: toEnvironment(required("LAKAUT_ENVIRONMENT")),
    allowedOrigin: ORIGIN,
    now: () => new Date(),
  }),
  documents: new InMemoryDocumentStore(),
  ceremonies,
  now: () => new Date(),
  maxDocumentBytes: LAKAUT_MAX_DOCUMENT_BYTES,
});

/** Everything a request body may legally carry. Anything else is rejected. */
interface OpenRequest {
  readonly journey: CeremonyJourney;
  readonly factors: AuthenticationFactors;
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

/** An error's message, or a stand-in. Never the value itself, which may carry bytes. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : "unknown failure";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function toOpenRequest(body: unknown): OpenRequest {
  if (!isObject(body)) throw new Error("body must be an object");

  const journey = readString(body, "journey");
  if (journey !== "signing" && journey !== "onboarding-and-signing") {
    throw new Error(`unknown journey ${journey}`);
  }

  const factors = readString(body, "factors");
  if (factors !== "email" && factors !== "sms" && factors !== "email-and-sms") {
    throw new Error(`unknown factors ${factors}`);
  }

  const monto = body.montoCentavos;
  if (typeof monto !== "number" || !Number.isSafeInteger(monto) || monto <= 0) {
    throw new Error("montoCentavos must be a positive integer count of centavos");
  }

  const phone = body.phone;

  return {
    journey,
    factors,
    email: readString(body, "email"),
    reference: readString(body, "reference"),
    montoCentavos: monto,
    ...(typeof phone === "string" && phone !== "" ? { phone } : {}),
  };
}

function toDeliveryRequest(body: unknown): DeliveryRequest {
  if (!isObject(body)) throw new Error("body must be an object");
  return {
    ceremonyId: readString(body, "ceremonyId"),
    documentId: readString(body, "documentId"),
    fileName: readString(body, "fileName"),
    bytesBase64: readString(body, "bytesBase64"),
    signedContentHash: readString(body, "signedContentHash"),
    finalPdfHash: readString(body, "finalPdfHash"),
    signedAt: readString(body, "signedAt"),
  };
}

/**
 * Writes the verified artefact to disk before the binding is registered.
 *
 * A demo's stand-in for durable custody, but the *ordering* is not a stand-in:
 * the provider calls this between verifying and binding, and a rejection here
 * cancels the binding rather than leaving an artefact bound but unarchived
 * (STYLES §9.5). Failing this write is therefore the correct way to fail.
 */
async function archive(artifact: VerifiedArtifact): Promise<void> {
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(join(EVIDENCE, `${artifact.documentId}.pdf`), artifact.bytes);
  await writeFile(
    join(EVIDENCE, `${artifact.documentId}.json`),
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

async function openCeremony(body: unknown): Promise<unknown> {
  const request = toOpenRequest(body);

  const bytes = renderPagare({
    reference: request.reference,
    montoCentavos: request.montoCentavos,
    librador: request.email,
    lugarDePago: "Ciudad Autónoma de Buenos Aires",
    vencimiento: "2027-09-11",
  });

  const sealed = await core.seal(bytes, request.reference);
  const ceremony = await core.openCeremony(
    sealed.documentId,
    {
      role: "librador",
      email: request.email,
      externalUserRef: request.reference,
      ...(request.phone !== undefined ? { phone: request.phone } : {}),
    },
    { journey: request.journey, factors: request.factors },
  );

  // Safe to log: no token, no DNI, no bytes (STYLES §8.1).
  console.log(
    `opened  journey=${request.journey} factors=${request.factors} ` +
      `sessionId=${ceremony.ceremonyId} documentId=${sealed.documentId}`,
  );

  return {
    // Exactly what the provider produced for a renderer. Never hand-built (§8.2).
    handoff: ceremony.handoff,
    ceremonyId: ceremony.ceremonyId,
    fileName: `${request.reference.replaceAll("/", "-")}.pdf`,
    document: {
      documentId: sealed.documentId,
      contentHash: sealed.contentHash,
      bytesBase64: Buffer.from(sealed.bytes).toString("base64"),
      sealedAt: sealed.sealedAt,
    },
  };
}

async function ingestDelivery(body: unknown): Promise<unknown> {
  const request = toDeliveryRequest(body);

  const delivery: SignedDelivery = {
    ceremonyId: request.ceremonyId as CeremonyId,
    documentId: request.documentId as DocumentId,
    fileName: request.fileName,
    bytes: new Uint8Array(Buffer.from(request.bytesBase64, "base64")),
    signedContentHash: request.signedContentHash as ContentHash,
    finalPdfHash: request.finalPdfHash as ContentHash,
    signedAt: request.signedAt,
  };

  const verified = await core.ingest(delivery, archive);
  console.log(`ingested documentId=${verified.documentId} verifiedAt=${verified.verifiedAt}`);

  return {
    documentId: verified.documentId,
    signatures: verified.signatures,
    verifiedAt: verified.verifiedAt,
    archivedTo: `evidence/${verified.documentId}.pdf`,
  };
}

const CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
});

async function serveStatic(path: string, response: ServerResponse): Promise<void> {
  const name = path === "/" ? "index.html" : path.slice(1);
  // No traversal: the browser only ever needs two files, so allow only those.
  if (name !== "index.html" && name !== "client.js") {
    response.writeHead(404).end("not found");
    return;
  }

  const body = await readFile(join(WEB, name));
  response
    .writeHead(200, { "content-type": CONTENT_TYPES[extname(name)] ?? "text/plain" })
    .end(body);
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
  if (WEBHOOK_SECRET === "") {
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
      reply = answerWebhookChallenge(raw, request.headers, WEBHOOK_SECRET);
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
    event = readCeremonyNotification(raw, request.headers, WEBHOOK_SECRET);
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

function readRaw(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("unparseable body"));
      }
    });
  });
}

function json(response: ServerResponse, status: number, payload: unknown): void {
  response
    .writeHead(status, { "content-type": "application/json; charset=utf-8" })
    .end(JSON.stringify(payload));
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && !url.pathname.startsWith("/api/")) {
    await serveStatic(url.pathname, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/webhooks/lakaut") {
    await handleWebhook(request, response, await readRaw(request));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/ceremonies") {
    json(response, 201, await openCeremony(await readBody(request)));
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/ceremonies/")) {
    const ceremonyId = url.pathname.slice("/api/ceremonies/".length) as CeremonyId;
    json(response, 200, await core.reconcile(ceremonyId));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/deliveries") {
    json(response, 200, await ingestDelivery(await readBody(request)));
    return;
  }

  json(response, 404, { error: "no such route" });
}

createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    const message = describe(error);
    // The message may name an error code, which is safe and traceable (§8.1).
    console.error(`${request.method} ${request.url} -> ${message}`);
    if (!response.headersSent) json(response, 500, { error: message });
  });
}).listen(3000, () => {
  console.log(`listening on http://localhost:3000  declared origin ${ORIGIN}`);
});
