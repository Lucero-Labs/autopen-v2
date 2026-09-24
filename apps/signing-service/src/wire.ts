/**
 * The shapes that cross the wire between the router and the two pages. No
 * Node import, so the same declarations typecheck in both programs.
 */

import type { CeremonyDisposition, CeremonyHandoff, CeremonyState } from "@autopen/core";

/**
 * Whether the service holds a verified signed copy.
 *
 * `signed` is set only after `ingest` resolves: the browser or the provider
 * saying the flow completed is still `awaiting-signature` here (STYLES §9.1).
 */
export type InstrumentState = "awaiting-signature" | "signed";

/**
 * What the signing page is told when it asks for its status: `InstrumentState`
 * plus the provider's own view, so the end screen can say why nothing was
 * signed. `awaiting-delivery` is signed at the provider, nothing in custody yet.
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
 * `POST /api/instruments` and `GET /api/instruments/{id}`: what a product holds
 * about an instrument. The token travels only inside `signingUrl`.
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

/** What `GET /health` reports about the database, from a TCP probe; `unconfigured` is not a fault. */
export type DatabaseReachability = "unconfigured" | "reachable" | "unreachable";

/** `GET /health`. Unauthenticated, and so carries nothing a stranger should not read. */
export interface HealthResponse {
  readonly ok: true;
  readonly environment: string;
  readonly database: DatabaseReachability;
}

/**
 * Every non-2xx body. A refusal (4xx) says why; a failure (5xx) says only that
 * it failed, plus the provider's `correlationId` when it carried one.
 */
export interface ErrorResponse {
  readonly error: string;
  readonly correlationId?: string;
}
