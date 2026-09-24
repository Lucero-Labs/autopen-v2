/**
 * A backend for exercising both signing journeys against preproduction.
 *
 * Deliberately the smallest thing that is still honest about the invariants it
 * demonstrates. It seals real bytes, opens a real ceremony, and reconciles
 * against the provider's own record rather than the browser's word for it
 * (STYLES §9.1). Everything it persists lives in memory or in a directory, so
 * restarting it forgets everything but the archived copies.
 *
 * What it is not: a product. There is no policy gate in front of the seal, no
 * durable store behind it, and one shared API key rather than a product's
 * own. Anything here that looks like a decision was made for the demo, not for
 * the core — the core's decisions are in `docs/design/signing-spine.md`.
 *
 * This file is wiring only: the environment, the ports, and `listen`. The
 * routes themselves are in `routes.ts`, which never sees the environment.
 */

import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DefaultSigningCore, InMemoryCeremonyLedger, InMemoryDocumentStore } from "@autopen/core";
import {
  checkSigningEligibility,
  createLakautProvider,
  LAKAUT_MAX_DOCUMENT_BYTES,
} from "@autopen/adapter-lakaut";

import { env } from "./env.ts";
import { DirectoryEvidenceStore } from "./evidence.ts";
import { probeDatabase } from "./health.ts";
import { cryptoInstrumentIds, InMemoryInstrumentStore } from "./instruments.ts";
import { createRouter } from "./routes.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB = join(HERE, "..", "web");
// A mounted volume on a host, the app's own directory on a laptop. Resolved
// once so the log line names the absolute path the copies actually land in.
const EVIDENCE =
  env.EVIDENCE_DIR !== undefined ? resolve(env.EVIDENCE_DIR) : join(HERE, "..", "evidence");

/** How long `/health` waits for the database host before calling it unreachable. */
const DATABASE_PROBE_TIMEOUT_MS = 2_000;

const LAKAUT = {
  baseUrl: env.LAKAUT_AUTH_BASE_URL,
  integratorId: env.LAKAUT_INTEGRATOR_ID,
  apiKey: env.LAKAUT_API_KEY,
  environment: env.LAKAUT_ENVIRONMENT,
  allowedOrigin: env.LAKAUT_ALLOWED_ORIGIN,
  now: () => new Date(),
} as const;

const documents = new InMemoryDocumentStore();
const ceremonies = new InMemoryCeremonyLedger();

const core = new DefaultSigningCore({
  provider: createLakautProvider(LAKAUT),
  documents,
  ceremonies,
  now: () => new Date(),
  maxDocumentBytes: LAKAUT_MAX_DOCUMENT_BYTES,
});

// Fail closed at boot: a copy that cannot be archived cancels its binding, and
// finding that out after a signer has spent a PIN is the expensive way
// (STYLES §0.1). The message names the path, which is safe to print.
const evidence = new DirectoryEvidenceStore(EVIDENCE);
try {
  await evidence.ensureWritable();
} catch (error) {
  console.error(error instanceof Error ? error.message : "evidence directory check failed");
  process.exit(1);
}

const server = createServer(
  createRouter({
    core,
    checkEligibility: (subject) => checkSigningEligibility(LAKAUT, subject),
    instruments: new InMemoryInstrumentStore(),
    documents,
    ceremonies,
    evidence,
    ids: cryptoInstrumentIds,
    allowedOrigin: env.LAKAUT_ALLOWED_ORIGIN,
    hostedUiOrigin: env.LAKAUT_HOSTED_UI_ORIGIN,
    // Read once rather than per request: rotation is a deploy, not a reload,
    // and a value that can change under a running verifier is how a rotation
    // silently half-applies. Blank until a destination is saved in the
    // dashboard, which is correct.
    webhookSecret: env.LAKAUT_WEBHOOK_SECRET,
    webRoot: WEB,
    apiKey: env.AUTOPEN_API_KEY,
    environment: env.LAKAUT_ENVIRONMENT,
    database: () => probeDatabase(env.DATABASE_URL, { timeoutMs: DATABASE_PROBE_TIMEOUT_MS }),
    now: () => new Date(),
  }),
).listen(env.PORT, () => {
  // Safe to log: a port, a declared origin and a directory. No key, no URL
  // with a password in it (STYLES §8.1).
  console.log(
    `listening on port ${env.PORT}  declared origin ${env.LAKAUT_ALLOWED_ORIGIN}  evidence ${EVIDENCE}`,
  );
});

// In a container Node is PID 1, and PID 1 gets no default signal disposition:
// without a handler SIGTERM is ignored, the host waits out its grace period
// and then kills the process mid-request. Stop accepting, let in-flight
// requests finish, and exit cleanly instead.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, closing`);
    server.close(() => process.exit(0));
  });
}
