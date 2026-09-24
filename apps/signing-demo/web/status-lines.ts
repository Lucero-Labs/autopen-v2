/**
 * What the signing page says, in the signer's language.
 *
 * Kept apart from `sign.ts` so a test can assert the exact text without a DOM
 * (STYLES §10): the message is the product, and a test that passes when it
 * changes protects nothing. Operator-facing text is Spanish and lives beside
 * the code that emits it, not in a UI layer (STYLES §3.2).
 */

/** The one line above the ceremony. */
export const STATUS_LINES = Object.freeze({
  preparing: "Preparando la firma…",
  ready: "Firmá tu documento",
  verifying: "Verificando la firma…",
  signed: "Listo: el documento quedó firmado",
  alreadySigned: "Este documento ya quedó firmado",
  awaitingDelivery: "La firma se hizo, pero todavía no recibimos la copia",
  failed: "Algo falló; podés reintentar",
  deliveryFailed: "La firma se hizo, pero no pudimos guardar la copia. Reintentá el envío.",
  notFound: "Este enlace no existe",
  cancelled: "La firma se canceló",
  expired: "La sesión de firma venció",
  wrongPage: "Esta página no es la que corresponde a tu firma",
} as const);

/** The monospace detail under the status line: prefixes and stand-ins. */
export const DETAIL_LINES = Object.freeze({
  error: "error:",
  unknownError: "desconocido",
  statusUnreadable: "no se pudo leer el estado:",
  authoritativeState: "estado autoritativo:",
  archivedAt: "verificado y archivado en",
} as const);
