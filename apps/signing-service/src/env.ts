/**
 * The service's configuration, validated once at import.
 *
 * Fail closed at boot rather than at the first ceremony: a missing or malformed
 * value otherwise surfaces three steps later as a provider error that reads like
 * a dashboard problem — `FORBIDDEN_ORIGIN`, a bare "refused to connect", a 404
 * from a base URL pointed at the tunnel (STYLES §0.1). Every variable is
 * described in `.env.example`; the constraints are in `env-schema.ts`, and the
 * messages there say only what to fix.
 *
 * Reporting prints each variable's name and what is wrong with it, never its
 * value. The same code path validates `LAKAUT_API_KEY` and `AUTOPEN_API_KEY`,
 * and the library's default reporter prints whole issue objects (STYLES §8.1).
 */

import { createEnv } from "@t3-oss/env-core";

import { ENV_SCHEMA } from "./env-schema.ts";

/**
 * The process environment, typed and checked.
 *
 * Import this instead of reading `process.env`. A blank value counts as unset:
 * `.env.example` ships every key with an empty right-hand side, and a copied but
 * unfilled line must fail the same way a missing one does.
 */
export const env = createEnv({
  server: ENV_SCHEMA,
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
