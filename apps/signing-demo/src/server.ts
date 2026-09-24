/**
 * A backend for exercising both signing journeys against preproduction.
 *
 * Deliberately the smallest thing that is still honest about the invariants it
 * demonstrates. It seals real bytes, opens a real ceremony, and reconciles
 * against the provider's own record rather than the browser's word for it
 * (STYLES §9.1). Everything it persists lives in memory or in a directory, so
 * restarting it forgets everything.
 *
 * What it is not: a product. There is no policy gate in front of the seal, no
 * durable store behind it, and no authentication of the caller. Anything here
 * that looks like a decision was made for the demo, not for the core — the
 * core's decisions are in `docs/design/signing-spine.md`.
 *
 * This file is wiring only: the environment, the ports, and `listen`. The
 * routes themselves are in `routes.ts`, which never sees the environment.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DefaultSigningCore,
  InMemoryCeremonyLedger,
  InMemoryDocumentStore,
  type VerifiedArtifact,
} from "@autopen/core";
import {
  checkSigningEligibility,
  createLakautProvider,
  LAKAUT_MAX_DOCUMENT_BYTES,
} from "@autopen/adapter-lakaut";

import { env } from "./env.ts";
import { cryptoInstrumentIds, InMemoryInstrumentStore } from "./instruments.ts";
import { createRouter } from "./routes.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB = join(HERE, "..", "web");
const EVIDENCE = join(HERE, "..", "evidence");

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

/**
 * Writes the verified artefact to disk before the binding is registered.
 *
 * A demo's stand-in for durable custody, but the *ordering* is not a stand-in:
 * the provider calls this between verifying and binding, and a rejection here
 * cancels the binding rather than leaving an artefact bound but unarchived
 * (STYLES §9.5). Failing this write is therefore the correct way to fail.
 */
async function archive(artifact: VerifiedArtifact): Promise<void> {
  await mkdir(EVIDENCE, { recursive: true });
  await writeFile(join(EVIDENCE, `${artifact.documentId}.pdf`), artifact.bytes);
  await writeFile(
    join(EVIDENCE, `${artifact.documentId}.json`),
    JSON.stringify(
      {
        documentId: artifact.documentId,
        signedContentHash: artifact.signedContentHash,
        finalPdfHash: artifact.finalPdfHash,
        signatures: artifact.signatures,
        verifiedAt: artifact.verifiedAt,
      },
      null,
      2,
    ),
  );
}

createServer(
  createRouter({
    core,
    checkEligibility: (subject) => checkSigningEligibility(LAKAUT, subject),
    instruments: new InMemoryInstrumentStore(),
    documents,
    ceremonies,
    custody: archive,
    ids: cryptoInstrumentIds,
    allowedOrigin: env.LAKAUT_ALLOWED_ORIGIN,
    hostedUiOrigin: env.LAKAUT_HOSTED_UI_ORIGIN,
    // Read once rather than per request: rotation is a deploy, not a reload,
    // and a value that can change under a running verifier is how a rotation
    // silently half-applies. Blank until a destination is saved in the
    // dashboard, which is correct.
    webhookSecret: env.LAKAUT_WEBHOOK_SECRET,
    webRoot: WEB,
  }),
).listen(3000, () => {
  console.log(`listening on http://localhost:3000  declared origin ${env.LAKAUT_ALLOWED_ORIGIN}`);
});
