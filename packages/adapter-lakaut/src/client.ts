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

import type { Clock } from "@autopen/core";
import { HttpAuthTransport, SessionClient } from "@lakaut/server";
import type { CompatibilityMetadata } from "@lakaut/shared-contracts";

import { LakautSignatureProvider } from "./provider.js";

/**
 * Lakaut's three environments, restated so callers need not import the vendor.
 *
 * Structurally identical to `LakautEnvironment` in `@lakaut/shared-contracts`,
 * which is what keeps the assignment below type-safe; naming it here is what
 * keeps `@lakaut/*` out of every package but this one (STYLES §2).
 */
export type LakautEnvironment = "local" | "sandbox" | "production";

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

/** Assembles the transport, the session client and the provider around them. */
export function createLakautProvider(options: LakautClientOptions): LakautSignatureProvider {
  const transport = new HttpAuthTransport({
    baseUrl: options.baseUrl,
    integratorId: options.integratorId,
    apiKey: options.apiKey,
    environment: options.environment,
    compatibility: COMPATIBILITY,
  });

  return new LakautSignatureProvider({
    sessions: new SessionClient(transport),
    allowedOrigin: options.allowedOrigin,
    now: options.now,
  });
}
