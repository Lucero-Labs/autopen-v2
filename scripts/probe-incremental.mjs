// Asks Lakaut's session endpoint, raw, what it makes of the incremental opt-in.
//
// The SDK transport keeps only `code` and `message` from a rejected session,
// which is how a 400 arrives as the bare "INVALID_REQUEST The request cannot be
// processed." This sends the same body the SDK sends, for a one-page PDF built
// here, and prints the whole answer so the field Lakaut objects to is visible.
//
// It sends exactly one request, with the opt-in. A rejection creates nothing.
// An acceptance creates one SIGNING session for the given email — no PIN, no
// certificate, no document — and its clientToken is redacted before printing.
//
// Reads the repo-root .env itself. No secret is passed on the command line,
// echoed, or printed.
//
// A second argument picks a variant of the body, to tell which part preprod
// objects to: `as-sdk` (default) is exactly what the SDK sends; `cap-1.3`
// declares `signed-document-reconciliation:1.3` instead of 1.2, which the SDK
// refuses client-side but the server may know; `no-cap` sends the opt-in with
// no capabilities at all.
//
// Usage: node scripts/probe-incremental.mjs <signer email> [as-sdk|cap-1.3|no-cap]

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  console.error("No .env at the repo root. Copy .env.example and fill it in.");
  process.exit(1);
}

const [email, variant = "as-sdk"] = process.argv.slice(2);
if (email === undefined || !["as-sdk", "cap-1.3", "no-cap"].includes(variant)) {
  console.error("Usage: node scripts/probe-incremental.mjs <signer email> [as-sdk|cap-1.3|no-cap]");
  process.exit(1);
}

const integratorId = process.env.LAKAUT_INTEGRATOR_ID ?? "";
const apiKey = process.env.LAKAUT_API_KEY ?? "";
const baseUrl = process.env.LAKAUT_AUTH_BASE_URL ?? "";
const allowedOrigin = process.env.LAKAUT_ALLOWED_ORIGIN ?? "";

if (integratorId === "" || apiKey === "" || baseUrl === "" || allowedOrigin === "") {
  console.error(
    "Missing LAKAUT_AUTH_BASE_URL, LAKAUT_INTEGRATOR_ID, LAKAUT_API_KEY or LAKAUT_ALLOWED_ORIGIN in .env",
  );
  process.exit(1);
}

// The SDK's own preflight, resolved from the adapter package, so the request
// is byte-for-byte what the service sends.
const require = createRequire(join(root, "packages/adapter-lakaut/package.json"));
const { preflightIncrementalPdfForSession } = await import(
  require.resolve("@lakaut/server")
);

/** A one-page PDF with a correct cross-reference table; every byte ASCII. */
function onePagePdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
  ];
  let text = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) text += `${String(offset).padStart(10, "0")} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

const preflight = await preflightIncrementalPdfForSession({ pdfBytes: onePagePdf() });
console.log("preflight request", JSON.stringify(preflight.request));
console.log();

const body = {
  flowType: "SIGNING",
  authenticationProfileId: "auth.email.v1",
  allowedOrigin,
  externalUserRef: `probe-incremental-${Date.now()}`,
  email,
  ...(variant === "as-sdk" ? { capabilities: ["signed-document-reconciliation:1.2"] } : {}),
  ...(variant === "cap-1.3" ? { capabilities: ["signed-document-reconciliation:1.3"] } : {}),
  incrementalSigning: preflight.request,
};
console.log(`variant ${variant}`);

const response = await fetch(new URL("/v1/sdk/sessions", baseUrl), {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Integrator-Id": integratorId,
    "X-API-Key": apiKey,
  },
  body: JSON.stringify(body),
});

const text = await response.text();
let answer;
try {
  answer = JSON.parse(text);
} catch {
  answer = text.slice(0, 500);
}
if (answer !== null && typeof answer === "object" && "clientToken" in answer) {
  answer.clientToken = "<redacted>";
}
console.log(`POST /v1/sdk/sessions  HTTP ${response.status}`);
console.log(JSON.stringify(answer, null, 2));
