/**
 * HTTP wiring for the challenge responder.
 *
 * Built on `node:http` rather than a framework because the one thing that must
 * not happen here is a middleware parsing the body: the HMAC covers the bytes
 * as received, and a parse-then-re-serialise breaks it (STYLES §9.1). Reading
 * the stream directly makes that impossible to get wrong by accident.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { answerChallenge, type ChallengeOutcome, serialiseProof } from "./challenge.js";

/** Matches the limit in the vendor's own example handler. */
const MAX_REQUEST_BYTES = 64 * 1024;

/** A line the receiver may emit. Never carries the secret or a signature. */
export interface ChallengeLogLine {
  readonly outcome: ChallengeOutcome["kind"];
  readonly status: number;
  readonly reason: string | undefined;
  readonly challengeId: string | undefined;
  readonly at: string;
}

export interface ReceiverOptions {
  readonly secret: string;
  readonly path: string;
  readonly now: () => Date;
  readonly log: (line: ChallengeLogLine) => void;
}

/**
 * Reads a duplicated header as absent.
 *
 * Node surfaces a repeated header as an array, and picking one of them would
 * let a caller choose which value is verified. Fail closed instead.
 */
function header(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

async function readRawBody(request: IncomingMessage): Promise<Uint8Array | undefined> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = chunk as Buffer;
    total += bytes.length;
    if (total > MAX_REQUEST_BYTES) return undefined;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

/**
 * Builds the receiver without starting it, so a test can drive it on port 0.
 *
 * Everything non-deterministic — the clock, the sink — arrives as an option
 * (STYLES §4).
 */
export function createReceiver(options: ReceiverOptions): Server {
  return createServer((request: IncomingMessage, response: ServerResponse) => {
    void handle(request, response, options);
  });
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: ReceiverOptions,
): Promise<void> {
  const at = options.now().toISOString();

  if (request.method !== "POST" || request.url !== options.path) {
    response.writeHead(404).end();
    return;
  }

  const rawBody = await readRawBody(request);
  if (rawBody === undefined) {
    options.log({
      outcome: "malformed",
      status: 413,
      reason: "body exceeds 64 KiB",
      challengeId: undefined,
      at,
    });
    response.writeHead(413).end();
    return;
  }

  const outcome = answerChallenge({
    request: {
      headerId: header(request, "lakaut-webhook-id"),
      headerTimestamp: header(request, "lakaut-webhook-timestamp"),
      headerSignature: header(request, "lakaut-webhook-signature"),
      rawBody,
    },
    secret: options.secret,
    now: options.now(),
  });

  options.log({
    outcome: outcome.kind,
    status: outcome.status,
    reason: outcome.kind === "verified" ? undefined : outcome.reason,
    challengeId: outcome.kind === "verified" ? outcome.body.challengeId : undefined,
    at,
  });

  if (outcome.kind === "verified") {
    const body = serialiseProof(outcome.body);
    response
      .writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body, "utf8"),
      })
      .end(body);
    return;
  }

  response.writeHead(outcome.status).end();
}
