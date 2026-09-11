/**
 * The webhook destination challenge, as a pure function of its inputs.
 *
 * This is deliberately not the business-event lane, and the two are easy to
 * conflate because both are HMAC-SHA256 under a similarly named header. A
 * challenge is signed over `${timestamp}.${rawBody}` and arrives under
 * `Lakaut-Webhook-Signature`; a business event is signed over
 * `${timestamp}.${eventId}.${rawBody}`, arrives under `Lakaut-Signature`, and
 * must be verified by the SDK rather than by hand (STYLES §9.1). Only the
 * challenge is implemented here, and only because the vendor documents the
 * construction and answers it with `node:crypto` itself
 * (`docs/vendor/lakaut/sdk-integracion__configurar-webhook.md`).
 *
 * Keeping it pure is what makes it testable: the challenge is the one part of
 * the integration that can be exercised before a certificate, a DNI or a PIN
 * exists.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const CHALLENGE_TYPE = "lakaut.webhook.challenge";

/** Maximum size of the response body Lakaut will accept, in bytes. */
const MAX_RESPONSE_BYTES = 4096;

/** A request as it reaches the handler, with the body still unparsed. */
export interface ChallengeRequest {
  readonly headerId: string | undefined;
  readonly headerTimestamp: string | undefined;
  readonly headerSignature: string | undefined;
  /** The bytes exactly as received. Re-serialising a parse breaks the HMAC. */
  readonly rawBody: Uint8Array;
}

/** The body returned to Lakaut when a challenge verifies. */
export interface ChallengeProof {
  readonly challengeId: string;
  readonly nonce: string;
  readonly proof: string;
}

/**
 * What to do with a delivery, as a closed set rather than a body plus a status.
 *
 * `unsupported` exists because a 2xx is an acknowledgement: answering a business
 * event with 200 before the SDK lane is built would tell Lakaut the event was
 * handled and let it fall on the floor. Refusing delivery keeps it queued
 * (STYLES §0.1, §9.1).
 */
export type ChallengeOutcome =
  | { readonly kind: "verified"; readonly status: 200; readonly body: ChallengeProof }
  | { readonly kind: "malformed"; readonly status: 400; readonly reason: string }
  | { readonly kind: "rejected"; readonly status: 401; readonly reason: string }
  | { readonly kind: "unsupported"; readonly status: 503; readonly reason: string };

interface ChallengePayload {
  readonly type: string;
  readonly challengeId: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

function isChallengePayload(value: unknown): value is ChallengePayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === CHALLENGE_TYPE &&
    typeof candidate.challengeId === "string" &&
    typeof candidate.nonce === "string" &&
    typeof candidate.issuedAt === "string" &&
    typeof candidate.expiresAt === "string"
  );
}

function hmacHex(secret: string, parts: readonly (string | Uint8Array)[]): string {
  const mac = createHmac("sha256", secret);
  for (const part of parts) mac.update(part);
  return mac.digest("hex");
}

/**
 * Compares two signatures without leaking their contents through timing.
 *
 * The length check is not an optimisation: `timingSafeEqual` throws on a length
 * mismatch, and an attacker-supplied header controls that length.
 */
function equalsConstantTime(received: string, expected: string): boolean {
  const left = Buffer.from(received, "utf8");
  const right = Buffer.from(expected, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Decides how to answer one webhook delivery.
 *
 * Fails closed at every branch: an unparseable body, a header that disagrees
 * with the payload, a signature that does not match, an unparseable or past
 * `expiresAt`, and an event that is not a challenge all refuse rather than
 * answer. `now` is injected because a rule that reads the clock itself cannot
 * be tested against an expiry boundary (STYLES §4).
 */
export function answerChallenge(options: {
  readonly request: ChallengeRequest;
  readonly secret: string;
  readonly now: Date;
}): ChallengeOutcome {
  const { request, secret, now } = options;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(request.rawBody).toString("utf8"));
  } catch {
    return { kind: "malformed", status: 400, reason: "body is not valid JSON" };
  }

  if (!isChallengePayload(parsed)) {
    return {
      kind: "unsupported",
      status: 503,
      reason: "not a challenge; the business-event lane is not implemented",
    };
  }

  const { headerId, headerTimestamp, headerSignature } = request;
  if (headerId !== parsed.challengeId || headerTimestamp !== parsed.issuedAt) {
    return { kind: "malformed", status: 400, reason: "headers disagree with payload" };
  }

  // Two updates rather than one interpolated template: interpolating a byte
  // array decodes it as UTF-8 first, so a body that is not valid UTF-8 would be
  // hashed as replacement characters — a signature mismatch no log explains.
  const expected = `v1=${hmacHex(secret, [`${headerTimestamp}.`, request.rawBody])}`;
  if (headerSignature === undefined || !equalsConstantTime(headerSignature, expected)) {
    return { kind: "rejected", status: 401, reason: "signature does not verify" };
  }

  const expiresAt = Date.parse(parsed.expiresAt);
  if (Number.isNaN(expiresAt) || expiresAt < now.getTime()) {
    return { kind: "rejected", status: 401, reason: "challenge expired or has no valid expiry" };
  }

  return {
    kind: "verified",
    status: 200,
    body: Object.freeze({
      challengeId: parsed.challengeId,
      nonce: parsed.nonce,
      proof: `v1=${hmacHex(secret, [`${parsed.challengeId}.${parsed.nonce}`])}`,
    }),
  };
}

/** Serialises an outcome's body, refusing to exceed the vendor's size ceiling. */
export function serialiseProof(proof: ChallengeProof): string {
  const body = JSON.stringify(proof);
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("challenge response exceeds the 4096-byte ceiling");
  }
  return body;
}
