import { createHmac, randomUUID } from "node:crypto";

import {
  webhookCompletedFixture,
  webhookDocumentSignedFixture,
  webhookDocumentSignedV12Fixture,
  webhookDocumentSignedV13Fixture,
  type WebhookEventEnvelope,
} from "@lakaut/shared-contracts";
import { describe, expect, it } from "vitest";

import {
  answerWebhookChallenge,
  isWebhookChallenge,
  readCeremonyNotification,
  type WebhookHeaders,
} from "../src/webhooks.js";

const SECRET = "whsec_fixture_only_never_a_real_secret";
const OTHER_SECRET = "whsec_the_one_being_rotated_out";

/**
 * Signs a body the way Lakaut signs an *event*, which is not how it signs a
 * challenge.
 *
 * Events carry five headers and sign `${timestamp}.${eventId}.` + raw body,
 * with the signature as `t=<ts>,v1=<hex>`; challenges carry three headers and
 * sign `${timestamp}.` + raw body. Reproduced here from
 * `sdk-integracion__eventos-estado.md` rather than imported from the SDK, so
 * that a change in the vendor's signing fails these tests instead of silently
 * agreeing with itself.
 */
function signEvent(
  event: WebhookEventEnvelope,
  secret = SECRET,
  timestamp = new Date().toISOString(),
) {
  const body = JSON.stringify(event);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${event.id}.${body}`)
    .digest("hex");

  const headers: WebhookHeaders = {
    "lakaut-signature": `t=${timestamp},v1=${signature}`,
    "lakaut-event-id": event.id,
    "lakaut-event-type": event.type,
    "lakaut-event-timestamp": timestamp,
    "lakaut-schema-version": event.version,
  };
  return { body, headers };
}

function challenge(secret = SECRET) {
  const challengeId = randomUUID();
  const nonce = "bm9uY2VfZm9yX2FfdGVzdA";
  const issuedAt = new Date().toISOString();
  const body = JSON.stringify({
    schemaVersion: 1,
    type: "lakaut.webhook.challenge",
    challengeId,
    nonce,
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + 300_000).toISOString(),
  });
  const signature = createHmac("sha256", secret).update(`${issuedAt}.${body}`).digest("hex");

  return {
    challengeId,
    nonce,
    body,
    headers: {
      "lakaut-webhook-id": challengeId,
      "lakaut-webhook-timestamp": issuedAt,
      "lakaut-webhook-signature": `v1=${signature}`,
    } satisfies WebhookHeaders,
  };
}

describe("routing between the two webhook surfaces", () => {
  it("recognises a challenge, which must never reach the event verifier", () => {
    expect(isWebhookChallenge(challenge().body)).toBe(true);
  });

  it("does not mistake a business event for a challenge", () => {
    expect(isWebhookChallenge(JSON.stringify(webhookCompletedFixture))).toBe(false);
  });

  it("treats an unparseable body as not-a-challenge, so it fails verification instead", () => {
    expect(isWebhookChallenge("}{")).toBe(false);
  });
});

describe("answering the verification challenge", () => {
  it("returns the challenge's own id and nonce, which is what the dashboard checks", () => {
    const { challengeId, nonce, body, headers } = challenge();

    const reply = answerWebhookChallenge(body, headers, SECRET);

    expect(reply.challengeId).toBe(challengeId);
    expect(reply.nonce).toBe(nonce);
  });

  it("proves possession of the secret over challengeId.nonce", () => {
    const { challengeId, nonce, body, headers } = challenge();

    const reply = answerWebhookChallenge(body, headers, SECRET);

    const expected = createHmac("sha256", SECRET).update(`${challengeId}.${nonce}`).digest("hex");
    expect(reply.proof).toBe(`v1=${expected}`);
  });

  it("refuses a challenge signed with a different secret rather than answering it", () => {
    const { body, headers } = challenge("a-secret-we-do-not-hold");

    expect(() => answerWebhookChallenge(body, headers, SECRET)).toThrow();
  });

  it("fits inside the 4096-byte response limit", () => {
    const { body, headers } = challenge();

    const reply = answerWebhookChallenge(body, headers, SECRET);

    expect(Buffer.byteLength(JSON.stringify(reply), "utf8")).toBeLessThan(4096);
  });
});

describe("reading a verified event", () => {
  it("refuses an event whose signature does not verify", () => {
    const { body, headers } = signEvent(webhookCompletedFixture, "wrong-secret");

    expect(() => readCeremonyNotification(body, headers, SECRET)).toThrow();
  });

  it("refuses a body that was altered after signing, which is the whole point", () => {
    const { headers } = signEvent(webhookCompletedFixture);
    const tampered = JSON.stringify({ ...webhookCompletedFixture, sessionId: "someone-elses" });

    expect(() => readCeremonyNotification(tampered, headers, SECRET)).toThrow();
  });

  it("accepts either secret during a rotation, so in-flight retries are not dropped", () => {
    const { body, headers } = signEvent(webhookCompletedFixture, OTHER_SECRET);

    const event = readCeremonyNotification(body, headers, [SECRET, OTHER_SECRET]);

    expect(event.type).toBe("auth.session.completed");
  });

  it("carries the idempotency key, because handling has to be idempotent on it", () => {
    const { body, headers } = signEvent(webhookCompletedFixture);

    const event = readCeremonyNotification(body, headers, SECRET);

    expect(event.idempotencyKey).toBe(webhookCompletedFixture.idempotencyKey);
    expect(event.correlationId).toBe(webhookCompletedFixture.correlationId);
  });

  it("uses the session id as the ceremony id, matching how a ceremony is opened", () => {
    const { body, headers } = signEvent(webhookCompletedFixture);

    const event = readCeremonyNotification(body, headers, SECRET);

    expect(event.ceremonyId).toBe(webhookCompletedFixture.sessionId);
  });
});

/**
 * `auth.document.signed` exists at three contract versions and a handler that
 * accepts one silently misses the others — the vendor states there is no
 * backfill, so a missed version is a signature nobody ever reconciles
 * (STYLES §9.5). These assert the envelope survives all of them, including
 * `1.3.0`, which no document in this repository described before today.
 */
describe("every documented contract version of auth.document.signed", () => {
  const versions: readonly [string, WebhookEventEnvelope][] = [
    ["1.1.0", webhookDocumentSignedFixture],
    ["1.2.0", webhookDocumentSignedV12Fixture],
    ["1.3.0", webhookDocumentSignedV13Fixture],
  ];

  for (const [version, fixture] of versions) {
    it(`reports version ${version} rather than flattening it away`, () => {
      const { body, headers } = signEvent(fixture);

      const event = readCeremonyNotification(body, headers, SECRET);

      expect(event.version).toBe(version);
      expect(event.finalStatus).toBe("SIGNED");
    });
  }

  it("keeps the binding fields 1.2.0 adds, which 1.1.0 does not carry", () => {
    const { body, headers } = signEvent(webhookDocumentSignedV12Fixture);

    const event = readCeremonyNotification(body, headers, SECRET);

    expect(event.data["artifactBindingStatus"]).toBe("BOUND");
    expect(event.data["bindingId"]).toBeDefined();
    expect(event.data["finalPdfHash"]).toBeDefined();
  });

  it("keeps the PAdES B-T evidence 1.3.0 adds", () => {
    const { body, headers } = signEvent(webhookDocumentSignedV13Fixture);

    const event = readCeremonyNotification(body, headers, SECRET);

    expect(event.data["padesEvidence"]).toBeDefined();
  });

  it("leaves 1.1.0 without the binding fields, so the difference stays visible", () => {
    const { body, headers } = signEvent(webhookDocumentSignedFixture);

    const event = readCeremonyNotification(body, headers, SECRET);

    expect(event.data["artifactBindingStatus"]).toBeUndefined();
    expect(event.data["bindingId"]).toBeUndefined();
  });
});

describe("what a verified event must not expose", () => {
  it("carries no secret into the value a handler receives", () => {
    const { body, headers } = signEvent(webhookDocumentSignedV13Fixture);

    const event = readCeremonyNotification(body, headers, SECRET);

    expect(JSON.stringify(event)).not.toContain(SECRET);
  });

  it("freezes the event, because it is a record of something that happened", () => {
    const { body, headers } = signEvent(webhookCompletedFixture);

    const event = readCeremonyNotification(body, headers, SECRET);

    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.data)).toBe(true);
  });
});
