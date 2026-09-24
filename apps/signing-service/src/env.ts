/**
 * The service's configuration, validated once at import.
 *
 * Fail closed at boot rather than at the first ceremony: a missing or malformed
 * value otherwise surfaces later as a provider error that reads like a
 * dashboard problem (STYLES §0.1). The schema and the reporter live in
 * `env-schema.ts`, where a test can reach them without a process environment.
 */

import { createEnv } from "@t3-oss/env-core";

import { ENV_SCHEMA, reportInvalidEnvironment } from "./env-schema.ts";

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
  onValidationError: reportInvalidEnvironment,
});
