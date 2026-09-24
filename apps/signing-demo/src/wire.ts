/**
 * The shapes that cross the wire between the router and the two pages.
 *
 * Its own module, with no Node import, so the same declarations typecheck in
 * the server program and in the browser one (`tsconfig.web.json`): the page
 * `import type`s them, and the test asserts against them. A shape stated three
 * times drifts three ways.
 */

import type { CeremonyDisposition, CeremonyHandoff, CeremonyState } from "@autopen/core";

/**
 * Whether the demo holds a verified signed copy.
 *
 * Two values only, and `signed` is set exclusively after `ingest` resolves:
 * the browser saying the flow completed, or the provider saying the session
 * completed, are both still `awaiting-signature` here (STYLES §9.1).
 */
export type InstrumentState = "awaiting-signature" | "signed";

/**
 * What the signing page is told when it asks for its status.
 *
 * Wider than `InstrumentState` on purpose. `signed` still means only that the
 * demo holds a verified copy. The rest restate the provider's own view of the
 * ceremony so the end screen can say why nothing was signed, and
 * `awaiting-delivery` names the gap the design document calls out: signed at
 * the provider, nothing in our custody yet.
 */
export type SigningStatus =
  | "awaiting-signature"
  | "awaiting-delivery"
  | "signed"
  | "cancelled"
  | "expired"
  | "failed";

/** The provider's reconciled view of a ceremony, minus anything a page must not see. */
export interface CeremonyView {
  readonly state: CeremonyState;
  readonly errorCode?: string;
  readonly disposition?: CeremonyDisposition;
  readonly correlationId: string;
}

/** `GET /api/sign/{token}/status`, and the handoff route's answer when there is nothing to mount. */
export interface StatusResponse {
  readonly state: SigningStatus;
  readonly ceremony?: CeremonyView;
}

/** `POST /api/sign/{token}/handoff` when there is a ceremony to mount. */
export interface HandoffResponse {
  readonly state: "awaiting-signature";
  readonly handoff: CeremonyHandoff;
  readonly ceremonyId: string;
  readonly fileName: string;
  readonly document: {
    readonly documentId: string;
    readonly contentHash: string;
    readonly bytesBase64: string;
    readonly sealedAt: string;
  };
}

/**
 * `POST /api/instruments` and `GET /api/instruments/{id}`: what a product holds about an instrument.
 *
 * `state` is the product's answer to "is it signed": `signed` only once a
 * verified copy is in custody, and then `GET /api/instruments/{id}/artifact`
 * produces it. The token is not here — it travels only inside `signingUrl`.
 */
export interface InstrumentResponse {
  readonly instrumentId: string;
  readonly reference: string;
  readonly documentId: string;
  readonly state: InstrumentState;
  readonly signingUrl: string;
}

/** `POST /api/sign/{token}/deliveries` once the copy is verified and in custody. */
export interface DeliveryResponse {
  readonly documentId: string;
  readonly verifiedAt: string;
}

/**
 * What `GET /health` reports about the database, from a TCP probe of its host and port.
 *
 * `unconfigured` is not a fault: the demo runs without a database. The other
 * two say whether the configured host answered, and nothing about which host.
 */
export type DatabaseReachability = "unconfigured" | "reachable" | "unreachable";

/**
 * `GET /health`. Unauthenticated, and so carries nothing a stranger should not read.
 *
 * `ok: true` means the process is up and answering; it says nothing about
 * `database`, which is reported alongside and may be `unreachable` while the
 * demo keeps serving. The probe behind `database` runs at most once every ten
 * seconds, so a burst of health checks costs one connection.
 */
export interface HealthResponse {
  readonly ok: true;
  readonly environment: string;
  readonly database: DatabaseReachability;
}

/**
 * Every non-2xx body.
 *
 * A refusal (4xx) says why — a 401 says only `unauthorized`. A failure (5xx)
 * says only that it failed, plus the provider's `correlationId` when the
 * failure carried one — the message stays in the server log, where the ops
 * person is, not in the signer's page.
 */
export interface ErrorResponse {
  readonly error: string;
  readonly correlationId?: string;
}
