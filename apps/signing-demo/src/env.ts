/**
 * The demo's configuration, validated once at import.
 *
 * Fail closed at boot rather than at the first ceremony: a missing or malformed
 * value otherwise surfaces three steps later as a provider error that reads like
 * a dashboard problem — `FORBIDDEN_ORIGIN`, a bare "refused to connect", a 404
 * from a base URL pointed at the tunnel (STYLES §0.1). Every variable is
 * described in `.env.example`; the messages here say only what to fix.
 *
 * Reporting prints each variable's name and what is wrong with it, never its
 * value. The same code path validates `LAKAUT_API_KEY`, and the library's
 * default reporter prints whole issue objects (STYLES §8.1).
 */

import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

/**
 * The process environment, typed and checked.
 *
 * Import this instead of reading `process.env`. A blank value counts as unset:
 * `.env.example` ships every key with an empty right-hand side, and a copied but
 * unfilled line must fail the same way a missing one does.
 */
export const env = createEnv({
  server: {
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
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  onValidationError: (issues) => {
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
  },
});
