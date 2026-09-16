/**
 * Builds a configured `LakautSignatureProvider` from credentials alone.
 *
 * It exists so that an application never has to import `@lakaut/*` in order to
 * use one. `LakautProviderOptions.sessions` takes a `SessionClient`, which only
 * the vendor package can construct — without this factory every consumer would
 * have to reach past the port, and the dependency rule in STYLES §2 would hold
 * on paper and nowhere else.
 *
 * Nothing here reads `process.env`. Credentials arrive as arguments so that the
 * one place they are loaded is the deploying application, which is also the
 * only place that knows where its secrets live (STYLES §8.2).
 */

import type { CeremonyJourney, Clock } from "@autopen/core";
import { HttpAuthTransport, SessionClient } from "@lakaut/server";
import type { CompatibilityMetadata } from "@lakaut/shared-contracts";

import { LakautSignatureProvider } from "./provider.ts";

/**
 * Lakaut's three environments, restated so callers need not import the vendor.
 *
 * Structurally identical to `LakautEnvironment` in `@lakaut/shared-contracts`,
 * which is what keeps the assignment below type-safe; naming it here is what
 * keeps `@lakaut/*` out of every package but this one (STYLES §2).
 */
export type LakautEnvironment = "local" | "sandbox" | "production";

/**
 * What the provider knows about a would-be signer, before any session exists.
 *
 * `journey` is directly usable as a `CeremonyPlan.journey`, which is the point:
 * the provider computes per identity what we would otherwise be guessing.
 *
 * `decision` is deliberately kept alongside it. The two are not the same
 * question — `CERTIFICATE_PREPARING` and `RETRY_LATER` both recommend no
 * journey at all, and a caller that reads only `journey` cannot tell "wait" from
 * "no answer". **And neither field accounts for signature quota**: a signer with
 * a valid certificate and no remaining balance reads as `READY_FOR_SIGNING`,
 * verified against preproduction on 2026-09-12
 * (`docs/research/ADDENDUM-quota.md` §2). This answers whether a certificate
 * exists, never whether a signature can happen.
 */
export interface SigningEligibility {
  readonly decision:
    | "READY_FOR_SIGNING"
    | "ONBOARDING_REQUIRED"
    | "CERTIFICATE_PREPARING"
    | "RETRY_LATER";
  readonly journey?: CeremonyJourney;
  readonly nextAction: "CREATE_SESSION" | "RETRY" | "CONTACT_LAKAUT";
  readonly retryAfterSeconds?: number;
  readonly checkedAt: string;
  /** Often only seconds after `checkedAt`. Re-read rather than cache. */
  readonly validUntil: string;
  readonly correlationId: string;
}

/**
 * Asks whether an identity already holds a signing certificate.
 *
 * The one read that costs nothing: no session is created, no document is
 * allocated, no PIN or certificate is touched (AGENTS.md). Safe to call before
 * every ceremony, and cheap enough that caching it is not worth the staleness.
 */
export async function checkSigningEligibility(
  options: LakautClientOptions,
  subject: { readonly email: string; readonly externalUserRef: string },
): Promise<SigningEligibility> {
  const decision = await sessionsFor(options).getSigningEligibility({
    email: subject.email,
    externalUserRef: subject.externalUserRef,
  });

  return Object.freeze({
    decision: decision.decision,
    ...(decision.recommendedJourneyId !== null
      ? { journey: toCeremonyJourney(decision.recommendedJourneyId) }
      : {}),
    nextAction: decision.nextAction,
    ...(decision.retryAfterSeconds !== null
      ? { retryAfterSeconds: decision.retryAfterSeconds }
      : {}),
    checkedAt: decision.checkedAt,
    validUntil: decision.validUntil,
    correlationId: decision.correlationId,
  });
}

/** The recommendation, in the port's vocabulary. */
function toCeremonyJourney(recommended: "SIGNING" | "ONBOARDING_AND_SIGNING"): CeremonyJourney {
  switch (recommended) {
    case "SIGNING":
      return "signing";
    case "ONBOARDING_AND_SIGNING":
      return "onboarding-and-signing";
  }
}

/**
 * The versions this adapter negotiates with, verbatim from the rc.40 docs.
 *
 * `sdk-integracion__backend-sesiones.md` states these values, and they are not
 * the `compatibilityFixture` the SDK also exports — that fixture claims
 * `minimumSdkVersion: "1.0.0"` and major version 1, which no `0.1.0-rc.*`
 * release satisfies.
 */
const COMPATIBILITY: CompatibilityMetadata = Object.freeze({
  sdkApiVersion: "1.0.0",
  eventProtocolVersion: "1.0.0",
  webhookSchemaVersion: "1.0.0",
  hostedUiVersion: "1.0.0",
  minimumSdkVersion: "0.1.0-rc.1",
  supportedSdkMajorVersions: Object.freeze([0]),
});

export interface LakautClientOptions {
  readonly baseUrl: string;
  readonly integratorId: string;
  /** Backend only. It must never reach a bundle, a response or a log (§8.2). */
  readonly apiKey: string;
  readonly environment: LakautEnvironment;
  /**
   * One concrete origin, declared in the Lakaut dashboard.
   *
   * A wildcard cannot occupy this field even when the dashboard accepts one:
   * the Hosted UI reaches the page by `postMessage`, which demands an exact
   * target.
   */
  readonly allowedOrigin: string;
  readonly now: Clock;
}

/** The configured session client. Shared by the provider and the free reads. */
function sessionsFor(options: LakautClientOptions): SessionClient {
  return new SessionClient(
    new HttpAuthTransport({
      baseUrl: options.baseUrl,
      integratorId: options.integratorId,
      apiKey: options.apiKey,
      environment: options.environment,
      compatibility: COMPATIBILITY,
    }),
  );
}

/** Assembles the transport, the session client and the provider around them. */
export function createLakautProvider(options: LakautClientOptions): LakautSignatureProvider {
  return new LakautSignatureProvider({
    sessions: sessionsFor(options),
    allowedOrigin: options.allowedOrigin,
    now: options.now,
  });
}
