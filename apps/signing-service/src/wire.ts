/**
 * The shapes that cross the wire. A product body is a zod schema, so one
 * declaration is the type, the parser and the OpenAPI document (`openapi.ts`);
 * a page body stays an interface, because it carries core types and belongs to
 * our own page, not to the contract a product reads. No Node import, so the
 * same declarations typecheck in both programs.
 *
 * Refusal messages are built from an issue's path and code in `routes.ts`,
 * never from zod's own text, so a schema here only names the message where the
 * generic form would not do.
 */

import { z } from "zod";

import type { CeremonyDisposition, CeremonyHandoff, CeremonyState } from "@autopen/core";

/** The vendor's cap on `fileName` (`sdk-integracion__documentos-firma.md`, "Validaciones del documento"). */
const MAX_FILE_NAME_CHARS = 180;

/**
 * Canonical RFC 4648 base64, padding included; the decoder is lenient, so this
 * comes first. A character class, not a quartet group: a grouped repetition
 * over a 28 MB body overflows the regex engine, and a class scans linearly.
 * Whole quartets are a refine.
 */
const BASE64_SHAPE = /^[A-Za-z0-9+/]*={0,2}$/;

const nonEmpty = z.string().min(1);

const fileName = nonEmpty
  .max(MAX_FILE_NAME_CHARS)
  .meta({ description: "What the signer downloads; at most 180 characters." });

// ─── Product API ────────────────────────────────────────────────────────────

/** Who signs, as a product names them. A blank `phone` is read as absent. */
const signerInput = z.object({
  email: nonEmpty.meta({ description: "Where the authority sends the OTP." }),
  phone: z.string().optional().meta({
    description:
      "E.164, e.g. +5491100000000; for Argentina +549 and the ten-digit mobile number. Required when the signer holds no certificate yet: onboarding authenticates by SMS as well.",
  }),
});

/** `POST /api/instruments`: the product's finished PDF, its name, and who signs. */
export const createInstrumentRequest = z.object({
  reference: nonEmpty.meta({
    description:
      "Your own id for the document. Part of the instrument's identity, and the handle the authority binds to the signer's email, so never reused for another person.",
  }),
  fileName: fileName
    .refine((name) => name.toLowerCase().endsWith(".pdf"), { error: "fileName must end with .pdf" })
    .meta({
      description: "What the signer downloads. Ends in .pdf, any case; at most 180 characters.",
    }),
  pdfBase64: nonEmpty
    .regex(BASE64_SHAPE, { error: "pdfBase64 must be base64" })
    .refine((encoded) => encoded.length % 4 === 0, { error: "pdfBase64 must be base64" })
    .meta({
      description:
        "The PDF, base64. Must start with %PDF- once decoded, and decode to at most 21 MiB.",
    }),
  signer: signerInput,
});

/** `POST /api/eligibility`: the person, by the reference the instrument will carry and their email. */
export const eligibilityRequest = z.object({
  reference: nonEmpty.meta({
    description: "The reference you will create the instrument with.",
  }),
  email: nonEmpty,
});

/**
 * Whether the service holds a verified signed copy.
 *
 * `signed` is set only after `ingest` resolves: the browser or the provider
 * saying the flow completed is still `awaiting-signature` here (STYLES §9.1).
 */
const instrumentState = z.enum(["awaiting-signature", "signed"]);

/** See `instrumentState`. */
export type InstrumentState = z.infer<typeof instrumentState>;

/**
 * `POST /api/instruments` and `GET /api/instruments/{id}`: what a product holds
 * about an instrument. The token travels only inside `signingUrl`.
 */
export const instrumentResponse = z
  .object({
    instrumentId: z.string(),
    reference: z.string(),
    documentId: z.string().meta({
      description: "Derived from reference and content hash: same bytes, same id, forever.",
    }),
    state: instrumentState,
    signingUrl: z.string().meta({
      description: "The page where the signer signs. Whoever holds it can open it.",
    }),
  })
  .readonly();

/** See `instrumentResponse`. */
export type InstrumentResponse = z.infer<typeof instrumentResponse>;

/**
 * The authority's answer to "does this person hold a signing certificate?".
 *
 * `READY_FOR_SIGNING` is the only yes. `ONBOARDING_REQUIRED` means the link
 * will run an identity check first, and that instrument needs `signer.phone`.
 * The other two mean not yet: `retryAfterSeconds` says when to ask again.
 */
const eligibilityDecision = z.enum([
  "READY_FOR_SIGNING",
  "ONBOARDING_REQUIRED",
  "CERTIFICATE_PREPARING",
  "RETRY_LATER",
]);

/**
 * `POST /api/eligibility`: the free read a product makes before creating an
 * instrument, so its mail can say "sign in a minute" or "bring your DNI".
 *
 * `journey` is absent when the authority recommends none. `validUntil` is
 * usually seconds after `checkedAt`: read again rather than cache.
 */
export const eligibilityResponse = z
  .object({
    decision: eligibilityDecision,
    journey: z.enum(["signing", "onboarding-and-signing"]).optional(),
    nextAction: z.enum(["CREATE_SESSION", "RETRY", "CONTACT_LAKAUT"]),
    retryAfterSeconds: z.number().int().nonnegative().optional(),
    checkedAt: z.string().meta({ description: "ISO 8601." }),
    validUntil: z.string().meta({ description: "ISO 8601, usually seconds after checkedAt." }),
    correlationId: z
      .string()
      .meta({ description: "The only handle the authority's support can trace." }),
  })
  .readonly();

/** See `eligibilityResponse`. */
export type EligibilityResponse = z.infer<typeof eligibilityResponse>;

/** What `GET /health` reports about the database, from a TCP probe; `unconfigured` is not a fault. */
const databaseReachability = z.enum(["unconfigured", "reachable", "unreachable"]);

/** See `databaseReachability`. */
export type DatabaseReachability = z.infer<typeof databaseReachability>;

/** `GET /health`. Unauthenticated, and so carries nothing a stranger should not read. */
export const healthResponse = z
  .object({
    ok: z.literal(true),
    environment: z.string(),
    database: databaseReachability,
  })
  .readonly();

/** See `healthResponse`. */
export type HealthResponse = z.infer<typeof healthResponse>;

/**
 * Every non-2xx body. A refusal (4xx) says why; a failure (5xx) says only that
 * it failed, plus the provider's `correlationId` when it carried one.
 */
export const errorResponse = z
  .object({
    error: z.string(),
    correlationId: z.string().optional(),
  })
  .readonly();

/** See `errorResponse`. */
export type ErrorResponse = z.infer<typeof errorResponse>;

// ─── Signing page ───────────────────────────────────────────────────────────

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

/** `POST /api/sign/{token}/deliveries`: the signed copy the page received, as the provider handed it over. */
export const deliveryRequest = z.object({
  ceremonyId: nonEmpty,
  documentId: nonEmpty,
  fileName,
  bytesBase64: nonEmpty,
  signedContentHash: nonEmpty,
  finalPdfHash: nonEmpty,
  signedAt: nonEmpty,
});

/** See `deliveryRequest`. */
export type DeliveryBody = Readonly<z.infer<typeof deliveryRequest>>;

/** `POST /api/sign/{token}/deliveries` once the copy is verified and in custody. */
export interface DeliveryResponse {
  readonly documentId: string;
  readonly verifiedAt: string;
}
