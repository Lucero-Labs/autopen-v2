/**
 * What the service reads from its environment, one schema per variable.
 *
 * Declared apart from `env.ts` so the constraints can be tested without a
 * process environment: `env.ts` validates `process.env` at import and throws
 * when it is incomplete, which a test of "PORT defaults to 3000" has no
 * business satisfying. Nothing here reads anything; it only says what is read,
 * and every message names what to fix without echoing a value (STYLES §8.1).
 */

import { z } from "zod";

/** The listening port when the environment names none. */
export const DEFAULT_PORT = 3000;

/** The per-variable constraints, keyed by the variable's name; `env.ts` applies them to `process.env`. */
export const ENV_SCHEMA = Object.freeze({
  LAKAUT_AUTH_BASE_URL: z.url({ error: "must be the Lakaut auth URL, not the tunnel" }),
  LAKAUT_INTEGRATOR_ID: z.uuid({
    error: 'must be the canonical UUID under "Empresa / contrato", not the readable slug',
  }),
  LAKAUT_API_KEY: z.string({ error: "is required" }).min(1, { error: "is required" }),
  LAKAUT_ENVIRONMENT: z.enum(["local", "sandbox", "production"], {
    error: "must be local, sandbox or production",
  }),
  // The Hosted UI needs camera access, which browsers grant only over https,
  // and `createSession` accepts any origin — so a wrong one would not fail
  // until the iframe declines to load (`sdk-integracion__frontend-hosted-ui.md`).
  LAKAUT_ALLOWED_ORIGIN: z.string({ error: "is required" }).startsWith("https://", {
    error: "must be an https origin declared in the dashboard — the tunnel, not localhost",
  }),
  // The Hosted UI's own origin, allow-listed by the signing page's CSP and
  // Permissions-Policy. Configured rather than derived: the vendor says the
  // integrator "no lo elige ni debe derivarlo del valor `sandbox`", and that
  // DEV, PREPROD and PROD need not share a host
  // (`sdk-integracion__seguridad.md`, "Content Security Policy"). Every
  // session's `hostedUiOrigin` is checked against this value before its
  // handoff is released, so a stale one fails at the handoff, not in an
  // iframe that silently refuses to load.
  LAKAUT_HOSTED_UI_ORIGIN: z.string({ error: "is required" }).startsWith("https://", {
    error: "must be the https origin of the Hosted UI, as given at onboarding",
  }),
  // Optional: blank until a destination is saved in the dashboard, which is
  // correct. The webhook route refuses deliveries while it is unset.
  LAKAUT_WEBHOOK_SECRET: z.string().optional(),
  // Railway injects one; a laptop takes the default.
  PORT: z.coerce
    .number({ error: "must be a port number" })
    .int({ error: "must be a whole port number" })
    .min(1, { error: "must be between 1 and 65535" })
    .max(65535, { error: "must be between 1 and 65535" })
    .default(DEFAULT_PORT),
  // Where verified signed copies are archived. Unset, the app's own `evidence/`.
  EVIDENCE_DIR: z.string().optional(),
  // The one key the product-facing routes require. Its value never reaches a
  // report: the reporter in `env.ts` prints names and messages only.
  AUTOPEN_API_KEY: z.string({ error: "is required" }).min(32, {
    error: "must be at least 32 characters — generate one with `openssl rand -base64 32`",
  }),
  // Optional. Only its host and port are used, by the health check's TCP
  // probe; nothing here opens a database connection.
  DATABASE_URL: z.url({ error: "must be a URL naming the database host" }).optional(),
});
