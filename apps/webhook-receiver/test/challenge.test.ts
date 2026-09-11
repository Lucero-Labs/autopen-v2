import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { answerChallenge, type ChallengeRequest, serialiseProof } from "../src/challenge.js";

const SECRET = "whsec_test_only_never_a_real_value";
const ISSUED_AT = "2026-08-13T15:00:00.000Z";
const EXPIRES_AT = "2026-08-13T15:05:00.000Z";
const BEFORE_EXPIRY = new Date("2026-08-13T15:04:59.999Z");
const AFTER_EXPIRY = new Date("2026-08-13T15:05:00.001Z");

const CHALLENGE = {
  schemaVersion: 1,
  type: "lakaut.webhook.challenge",
  challengeId: "5ae245d3-7eb4-4d4a-b71f-dde5b417dc34",
  nonce: "Zm9vYmFyLW5vbmNl",
  issuedAt: ISSUED_AT,
  expiresAt: EXPIRES_AT,
} as const;

/** Signs a body the way the vendor documents Lakaut signing it. */
function signed(payload: unknown, secret = SECRET): ChallengeRequest {
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const digest = createHmac("sha256", secret).update(`${ISSUED_AT}.`).update(rawBody).digest("hex");
  return {
    headerId: CHALLENGE.challengeId,
    headerTimestamp: ISSUED_AT,
    headerSignature: `v1=${digest}`,
    rawBody,
  };
}

describe("answerChallenge", () => {
  it("returns the proof Lakaut expects for a correctly signed challenge", () => {
    const outcome = answerChallenge({
      request: signed(CHALLENGE),
      secret: SECRET,
      now: BEFORE_EXPIRY,
    });

    expect(outcome.kind).toBe("verified");
    if (outcome.kind !== "verified") return;

    const expected = createHmac("sha256", SECRET)
      .update(`${CHALLENGE.challengeId}.${CHALLENGE.nonce}`)
      .digest("hex");
    expect(outcome.body.proof).toBe(`v1=${expected}`);
    expect(outcome.body.challengeId).toBe(CHALLENGE.challengeId);
    expect(outcome.body.nonce).toBe(CHALLENGE.nonce);
    expect(outcome.status).toBe(200);
  });

  it("rejects a body altered after signing", () => {
    const request = signed(CHALLENGE);
    const tampered: ChallengeRequest = {
      ...request,
      rawBody: Buffer.from(JSON.stringify({ ...CHALLENGE, nonce: "otro-nonce" }), "utf8"),
    };

    const outcome = answerChallenge({ request: tampered, secret: SECRET, now: BEFORE_EXPIRY });

    expect(outcome).toMatchObject({ kind: "rejected", status: 401 });
  });

  it("rejects a signature produced with a different secret", () => {
    const outcome = answerChallenge({
      request: signed(CHALLENGE, "whsec_the_previous_one_after_rotation"),
      secret: SECRET,
      now: BEFORE_EXPIRY,
    });

    expect(outcome).toMatchObject({ kind: "rejected", status: 401 });
  });

  it("rejects a challenge one millisecond past its expiry", () => {
    const outcome = answerChallenge({
      request: signed(CHALLENGE),
      secret: SECRET,
      now: AFTER_EXPIRY,
    });

    expect(outcome).toMatchObject({ kind: "rejected", status: 401 });
  });

  it("accepts a challenge one millisecond before its expiry", () => {
    const outcome = answerChallenge({
      request: signed(CHALLENGE),
      secret: SECRET,
      now: BEFORE_EXPIRY,
    });

    expect(outcome.kind).toBe("verified");
  });

  it("refuses when the id header disagrees with the payload", () => {
    const request = { ...signed(CHALLENGE), headerId: "a-different-challenge" };

    const outcome = answerChallenge({ request, secret: SECRET, now: BEFORE_EXPIRY });

    expect(outcome).toMatchObject({ kind: "malformed", status: 400 });
  });

  it("refuses when the signature header is missing entirely", () => {
    const request: ChallengeRequest = { ...signed(CHALLENGE), headerSignature: undefined };

    const outcome = answerChallenge({ request, secret: SECRET, now: BEFORE_EXPIRY });

    expect(outcome).toMatchObject({ kind: "rejected", status: 401 });
  });

  it("refuses a body that is not JSON", () => {
    const request: ChallengeRequest = {
      headerId: CHALLENGE.challengeId,
      headerTimestamp: ISSUED_AT,
      headerSignature: "v1=00",
      rawBody: Buffer.from("not json at all", "utf8"),
    };

    const outcome = answerChallenge({ request, secret: SECRET, now: BEFORE_EXPIRY });

    expect(outcome).toMatchObject({ kind: "malformed", status: 400 });
  });

  it("refuses delivery of a business event rather than acknowledging one it cannot verify", () => {
    const event = { schemaVersion: 1, type: "auth.document.signed", sessionId: "8f3c1e7a" };

    const outcome = answerChallenge({ request: signed(event), secret: SECRET, now: BEFORE_EXPIRY });

    // A 2xx would tell Lakaut the event was handled and drop it (STYLES §9.1).
    expect(outcome).toMatchObject({ kind: "unsupported", status: 503 });
  });
});

describe("what reaches a sink", () => {
  it("never carries the secret or the received signature into any outcome", () => {
    const requests: readonly ChallengeRequest[] = [
      signed(CHALLENGE),
      signed({ ...CHALLENGE, nonce: "otro" }),
      signed({ type: "auth.document.signed" }),
      { ...signed(CHALLENGE), headerId: "mismatched" },
    ];

    for (const request of requests) {
      for (const now of [BEFORE_EXPIRY, AFTER_EXPIRY]) {
        const serialised = JSON.stringify(answerChallenge({ request, secret: SECRET, now }));
        expect(serialised).not.toContain(SECRET);
        expect(serialised).not.toContain(request.headerSignature);
      }
    }
  });
});

describe("serialiseProof", () => {
  it("throws rather than sending a body Lakaut will refuse", () => {
    expect(() =>
      serialiseProof({ challengeId: "a", nonce: "n".repeat(5000), proof: "v1=00" }),
    ).toThrow(/4096/);
  });
});
