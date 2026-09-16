/**
 * Webhook ingress: the only channel that closes an operation without a browser.
 *
 * Two surfaces that arrive at one URL and share nothing else. The *challenge*
 * proves we control the endpoint; the *events* are business facts about a
 * ceremony. They differ in every part of their verification:
 *
 * | | Challenge | Event |
 * | --- | --- | --- |
 * | Headers | `Lakaut-Webhook-Id`, `-Timestamp`, `-Signature` | `Lakaut-Event-Id`, `-Type`, `-Timestamp`, `Lakaut-Signature`, `Lakaut-Schema-Version` |
 * | Signature | `v1=<hex>` | `t=<ts>,v1=<hex>` |
 * | Signed over | `<timestamp>.<rawBody>` | `<timestamp>.<eventId>.<rawBody>` |
 *
 * So the vendor's instruction that a challenge must never reach
 * `constructWebhookEvent` is not a stylistic one — nothing about the two lines
 * up (`sdk-integracion__configurar-webhook.md`, `__eventos-estado.md`). Both
 * are verified by the SDK rather than by hand: a parallel HMAC implementation
 * is one subtle bug away from accepting forged events, and the vendor says as
 * much.
 *
 * Everything here takes raw bytes. Parsing and re-serialising breaks the HMAC —
 * it is computed over exactly what arrived (STYLES §9.1). The body is parsed
 * only to *route* between challenge and event, never to reconstruct what gets
 * signed.
 */

import type { CeremonyId } from "@autopen/core";
import {
  constructWebhookChallengeResponse,
  constructWebhookEvent,
  type WebhookChallengeResponseV1,
} from "@lakaut/server";

/** Inbound headers, as a Node server hands them over. */
export type WebhookHeaders = Readonly<Record<string, string | string[] | undefined>>;

/** The challenge reply, to be serialised as the response body and nothing else. */
export type WebhookChallengeReply = WebhookChallengeResponseV1;

/**
 * A verified event about one ceremony.
 *
 * `idempotencyKey` is the field handling must be idempotent on, because
 * webhooks repeat (STYLES §9.1). `data` stays opaque: it is where a failure's
 * own detail lives, and narrowing it here would discard exactly the field a
 * caller is trying to read.
 */
export interface CeremonyNotification {
  readonly idempotencyKey: string;
  readonly type: string;
  readonly version: string;
  readonly ceremonyId: CeremonyId;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly finalStatus?: string;
  readonly externalUserRef?: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Routes between the two surfaces, by body type alone.
 *
 * Reads the parsed type and discards the parse. An unparseable body is not a
 * challenge, and falls through to event verification, which rejects it.
 */
export function isWebhookChallenge(rawBody: string | Buffer): boolean {
  try {
    const parsed: unknown = JSON.parse(
      typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"),
    );
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { type?: unknown }).type === "lakaut.webhook.challenge"
    );
  } catch {
    return false;
  }
}

/**
 * Verifies a challenge and builds its proof. Throws if anything fails to check.
 *
 * The SDK validates the raw bytes, the three headers, the expiry, the
 * identifier and the signature in constant time. Throwing rather than returning
 * a verdict is deliberate: a caller cannot accidentally answer an unverified
 * challenge (STYLES §6.2).
 */
export function answerWebhookChallenge(
  rawBody: string | Buffer,
  headers: WebhookHeaders,
  secret: string,
): WebhookChallengeReply {
  return constructWebhookChallengeResponse(rawBody, headers, secret);
}

/**
 * Verifies an event and restates it in the core's vocabulary.
 *
 * `secret` accepts an array, which is undocumented rotation support: during a
 * secret rotation both the old and new secret can be accepted, which is the
 * only way to avoid dropping in-flight retries (the vendor's own rotation
 * procedure asks for exactly this, step 3).
 */
export function readCeremonyNotification(
  rawBody: string | Buffer,
  headers: WebhookHeaders,
  secret: string | readonly string[],
): CeremonyNotification {
  const event = constructWebhookEvent(rawBody, headers, secret);

  return Object.freeze({
    idempotencyKey: event.idempotencyKey,
    type: event.type,
    version: event.version,
    ceremonyId: event.sessionId as CeremonyId,
    correlationId: event.correlationId,
    occurredAt: event.occurredAt,
    ...(event.finalStatus !== undefined ? { finalStatus: event.finalStatus } : {}),
    ...(event.userReference !== undefined ? { externalUserRef: event.userReference } : {}),
    data: Object.freeze({ ...event.data }),
  });
}
