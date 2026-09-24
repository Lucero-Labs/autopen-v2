/**
 * The service's configuration, validated once at import.
 *
 * Fail closed at boot rather than at the first ceremony: a missing or malformed
 * value otherwise surfaces later as a provider error that reads like a
 * dashboard problem (STYLES §0.1). Reporting prints each variable's name and
 * what is wrong with it, never its value: the library's default reporter
 * prints whole issue objects, and two of them hold API keys (STYLES §8.1).
 */

import { createEnv } from "@t3-oss/env-core";

import { ENV_SCHEMA } from "./env-schema.ts";

/**
 * The process environment, typed and checked; import this instead of reading `process.env`.
 *
 * A blank value counts as unset: `.env.example` ships every key empty, and a
 * copied but unfilled line must fail the same way a missing one does.
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
