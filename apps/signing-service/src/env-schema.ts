/**
 * What the service reads from its environment, one schema per variable, and
 * how a failed read is reported. Kept apart from `env.ts` so both can be
 * tested without a process environment; every message names what to fix
 * without echoing a value (§8.1).
 */

import type { StandardSchemaV1 } from "@t3-oss/env-core";
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
  // Browsers grant camera access only over https, and `createSession` accepts
  // any origin: a wrong one fails only when the iframe declines to load
  // (`sdk-integracion__frontend-hosted-ui.md`).
  LAKAUT_ALLOWED_ORIGIN: z.string({ error: "is required" }).startsWith("https://", {
    error: "must be an https origin declared in the dashboard — the tunnel, not localhost",
  }),
  // Configured rather than derived: the integrator "no lo elige ni debe
  // derivarlo del valor `sandbox`" (`sdk-integracion__seguridad.md`, "Content
  // Security Policy").
  LAKAUT_HOSTED_UI_ORIGIN: z.string({ error: "is required" }).startsWith("https://", {
    error: "must be the https origin of the Hosted UI, as given at onboarding",
  }),
  // Blank until a destination is saved in the dashboard; the webhook route
  // refuses deliveries meanwhile.
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
  // The one key the product-facing routes require.
  AUTOPEN_API_KEY: z.string({ error: "is required" }).min(32, {
    error: "must be at least 32 characters — generate one with `openssl rand -base64 32`",
  }),
  // Only its host and port are used, by the health check's TCP probe.
  DATABASE_URL: z.url({ error: "must be a URL naming the database host" }).optional(),
});

/**
 * Throws the one boot error, naming each variable and what is wrong with it,
 * never its value.
 *
 * Issues carry no input today; this reporter keeps it that way if a future
 * zod or t3 version adds one, where the library's default — printing whole
 * issue objects — would put an API key in the boot log (STYLES §8.1).
 */
export function reportInvalidEnvironment(issues: readonly StandardSchemaV1.Issue[]): never {
  const lines = issues.map((issue) => {
    const name =
      issue.path
        ?.map((segment) => String(typeof segment === "object" ? segment.key : segment))
        .join(".") ?? "(root)";
    return `  ${name} ${issue.message}`;
  });
  throw new Error(
    `the environment is invalid:\n${lines.join("\n")}\n` +
      "Copy .env.example to .env, fill it in, and restart — .env is read at boot only.",
  );
}
