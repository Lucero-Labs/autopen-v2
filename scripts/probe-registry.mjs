// Asserts that the Nexus credential works, and reports which version each
// channel resolves to.
//
// `docs/vendor/lakaut/` is a mirror taken at 0.1.0-rc.40 and is the citation
// source for every vendor claim in this repo. The dashboard tells integrators
// to install from the @preprod channel, so a channel pointing somewhere else is
// the difference between a citation that holds and one that does not.
//
// Queries the registry over HTTP rather than through `npm view`, which returns
// an empty string and exit 0 against this Nexus — a silence that reads as "no
// such package" and is not one.
//
// Reads LAKAUT_NPM_AUTH from the repo-root .env. It is never printed and never
// reaches a command line.
//
// Usage: node scripts/probe-registry.mjs

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The version docs/vendor/lakaut/ was mirrored at. */
const MIRRORED_AT = "0.1.0-rc.40";
const REGISTRY = "https://packages-preprod.lakautac.com.ar/repository/lakaut-sdk/";
const PACKAGES = ["@lakaut/server", "@lakaut/browser", "@lakaut/shared-contracts"];

try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  console.error("No .env at the repo root. Copy .env.example and fill it in.");
  process.exit(1);
}

const auth = process.env.LAKAUT_NPM_AUTH ?? "";
console.log("LAKAUT_NPM_AUTH", auth ? `set, ${auth.length} chars` : "(missing)");
console.log(`mirror pinned at ${MIRRORED_AT}`);
console.log();
if (auth === "") {
  console.error("Generate the Nexus credential in the dashboard and put it in .env.");
  process.exit(1);
}

let mismatched = false;

for (const name of PACKAGES) {
  const response = await fetch(REGISTRY + encodeURIComponent(name), {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!response.ok) {
    console.log(`${name}\n  ${response.status} ${response.statusText}\n`);
    mismatched = true;
    continue;
  }

  const body = await response.json();
  const tags = body["dist-tags"] ?? {};
  const versions = Object.keys(body.versions ?? {});

  console.log(name);
  // The per-build `candidate-*` tags are noise; the channels are what anyone
  // actually installs from.
  for (const [tag, version] of Object.entries(tags)) {
    if (tag.startsWith("candidate-")) continue;
    const note = tag === "preprod" && version !== MIRRORED_AT ? "   <- not the mirror" : "";
    console.log(`  ${tag.padEnd(8)} ${version}${note}`);
    if (tag === "preprod" && version !== MIRRORED_AT) mismatched = true;
  }
  console.log(`  ${MIRRORED_AT} published: ${versions.includes(MIRRORED_AT) ? "yes" : "NO"}`);
  console.log(`  latest published: ${versions.at(-1)}`);
  console.log();
}

if (mismatched) {
  console.log(`The @preprod channel does not point at ${MIRRORED_AT}.`);
  console.log("Pinning the exact version is what keeps the mirror's citations valid");
  console.log("(STYLES §1.1 requires exact versions anyway). Following the dashboard's");
  console.log("`@preprod` shortcut would install something the mirror does not describe.");
  process.exit(2);
}

console.log(`@preprod resolves to ${MIRRORED_AT} everywhere. The mirror is current.`);
