// Asks Lakaut's backend what it believes about one ceremony: the session's
// authoritative status and the signed-document status for one document. Both
// are reads; neither creates a session, allocates a document, or touches a PIN.
//
// This is the question behind "the screen said signed, the service says
// open": the screen is a browser event, these two reads are the record.
//
// Reads the repo-root .env itself. No secret is passed on the command line,
// echoed, or printed. The sessionId and documentId come from a service log
// line (`opened … sessionId=… documentId=…`), which is safe to paste.
//
// Usage: node scripts/probe-session.mjs <sessionId> <documentId>

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  console.error("No .env at the repo root. Copy .env.example and fill it in.");
  process.exit(1);
}

const [sessionId, documentId] = process.argv.slice(2);
if (sessionId === undefined || documentId === undefined) {
  console.error("Usage: node scripts/probe-session.mjs <sessionId> <documentId>");
  process.exit(1);
}

const integratorId = process.env.LAKAUT_INTEGRATOR_ID ?? "";
const apiKey = process.env.LAKAUT_API_KEY ?? "";
const baseUrl = process.env.LAKAUT_AUTH_BASE_URL ?? "";

if (integratorId === "" || apiKey === "" || baseUrl === "") {
  console.error("Missing LAKAUT_AUTH_BASE_URL, LAKAUT_INTEGRATOR_ID or LAKAUT_API_KEY in .env");
  process.exit(1);
}

const headers = { "X-Integrator-Id": integratorId, "X-API-Key": apiKey };
const session = encodeURIComponent(sessionId);
const document = encodeURIComponent(documentId);

async function read(label, path) {
  const response = await fetch(new URL(path, baseUrl), { headers });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 300);
  }
  console.log(`${label}  HTTP ${response.status}`);
  console.log(JSON.stringify(body, null, 2));
  console.log();
}

await read("session status        ", `/v1/sdk/sessions/${session}/status`);
await read("signed document status", `/v1/sdk/sessions/${session}/documents/${document}/status`);
