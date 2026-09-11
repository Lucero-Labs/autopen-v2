// Asserts that the API key works and prints what the integration may actually
// use. `GET /v1/sdk/catalog` is the safest call in the API: read-only, creates
// no session, allocates no document, and touches neither a DNI nor a PIN.
//
// STYLES §9.4 requires the catalogue to be asserted rather than hardcoded, so
// this is the same check a service would run at boot, done by hand first.
//
// Reads the repo-root .env itself. No secret is passed on the command line,
// echoed, or printed: the API key is only ever reported as present or absent.
//
// Usage: node scripts/probe-catalog.mjs

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  console.error("No .env at the repo root. Copy .env.example and fill it in.");
  process.exit(1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const integratorId = process.env.LAKAUT_INTEGRATOR_ID ?? "";
const apiKey = process.env.LAKAUT_API_KEY ?? "";
const baseUrl = process.env.LAKAUT_AUTH_BASE_URL ?? "";

console.log("configuration");
console.log("  LAKAUT_AUTH_BASE_URL  ", baseUrl || "(missing)");
console.log("  LAKAUT_INTEGRATOR_ID  ", integratorId || "(missing)");
console.log("  LAKAUT_API_KEY        ", apiKey ? `set, ${apiKey.length} chars` : "(missing)");
console.log();

const missing = [
  ["LAKAUT_AUTH_BASE_URL", baseUrl],
  ["LAKAUT_INTEGRATOR_ID", integratorId],
  ["LAKAUT_API_KEY", apiKey],
].filter(([, value]) => value === "");

if (missing.length > 0) {
  console.error(`Missing: ${missing.map(([name]) => name).join(", ")}`);
  process.exit(1);
}

// The canonical integrator id is a UUID. A readable slug in this field is the
// documented way this breaks, and it fails as a 401 that looks like a bad key.
if (!UUID.test(integratorId)) {
  console.error("LAKAUT_INTEGRATOR_ID is not a UUID — this looks like the slug.");
  console.error("Copy the UUID from the dashboard under Empresa / contrato.");
  process.exit(1);
}

const response = await fetch(new URL("/v1/sdk/catalog", baseUrl), {
  method: "GET",
  headers: { "X-Integrator-Id": integratorId, "X-API-Key": apiKey },
});

console.log(`GET /v1/sdk/catalog -> ${response.status} ${response.statusText}`);
console.log();

const text = await response.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  console.error("Response was not JSON:");
  console.error(text.slice(0, 400));
  process.exit(1);
}

if (!response.ok) {
  // An error code is safe to log and is the handle vendor support can trace.
  console.error("code       ", body.code ?? "(none)");
  console.error("message    ", body.message ?? "(none)");
  console.error("correlation", body.correlationId ?? "(none)");
  process.exit(1);
}

console.log(`catalogVersion ${body.catalogVersion}   vocabularyVersion ${body.vocabularyVersion}`);
console.log();

console.log("journeys");
for (const journey of body.journeys ?? []) {
  console.log(`  ${journey.id} v${journey.version}`);
  console.log(`    flowKind ${journey.flowKind}   legacyFlowType ${journey.legacyFlowType}`);
  console.log(`    defaultAuthenticationProfileId ${journey.defaultAuthenticationProfileId}`);
}
console.log();

console.log("authenticationProfiles");
for (const profile of body.authenticationProfiles ?? []) {
  console.log(`  ${profile.id} v${profile.version}`);
  console.log(`    factors ${(profile.factors ?? []).join(", ")}`);
  console.log(`    requiredInputs ${(profile.requiredInputs ?? []).join(", ")}`);
  console.log(`    requiresServerBoundIdentity ${profile.requiresServerBoundIdentity}`);
}
console.log();

console.log("allowedCombinations");
for (const combination of body.allowedCombinations ?? []) {
  console.log(`  ${combination.journeyId} + ${combination.authenticationProfileId}`);
}

// The npm channel and the service can disagree, so version-check both. A route
// that does not exist answers 404 before it looks at a body — so an empty body
// separates "endpoint absent" from "endpoint present, bad input" without
// sending a single identity field.
console.log();
console.log("rc.40 endpoints, by presence (empty body on purpose)");

const rc40 = [
  ["/v1/sdk/signing-eligibility", "getSigningEligibility (ADDENDUM §3)"],
  [
    "/v1/sdk/sessions/00000000-0000-4000-8000-000000000000/documents/probe/signed-artifact-binding",
    "artifact binding 1.2 (ADDENDUM §4)",
  ],
];

for (const [path, what] of rc40) {
  const probe = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      "X-Integrator-Id": integratorId,
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const verdict = probe.status === 404 ? "ABSENT — service predates rc.40" : "present";
  console.log(`  ${probe.status}  ${verdict.padEnd(32)} ${what}`);
}
