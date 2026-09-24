/**
 * The issuer's page: describe an instrument, get a link.
 *
 * Nothing here mounts a ceremony; the backend decides the journey when the
 * signer opens the link. The page stands in for a product's backend, which is
 * why it holds the API key at all: in `sessionStorage`, dying with the tab,
 * reaching nothing but the `Authorization` header.
 */

import type { InstrumentResponse } from "../src/wire.ts";

interface Eligibility {
  readonly decision: string;
  readonly journey?: string;
  readonly nextAction: string;
}

/** Where the key is kept for this tab. Never the URL, never a log line. */
const API_KEY_STORAGE = "autopen.apiKey";

const form = document.querySelector("#plan") as HTMLFormElement;
const log = document.querySelector("#log") as HTMLElement;
const check = document.querySelector("#check") as HTMLButtonElement;
const link = document.querySelector("#link") as HTMLElement;
const linkAnchor = document.querySelector("#link-anchor") as HTMLAnchorElement;
const linkUrl = document.querySelector("#link-url") as HTMLElement;
const apiKeyField = document.querySelector("#api-key") as HTMLInputElement;

/**
 * A reference nobody has used before, generated per page load.
 *
 * `externalUserRef` binds permanently to the first email it is seen with —
 * undocumented, measured against preproduction on 2026-09-13 — and reusing it
 * with another signer fails the eligibility read with a bare `INVALID_REQUEST`.
 */
(form.elements.namedItem("reference") as HTMLInputElement).value =
  `ar.pagare/harness-${Math.random().toString(36).slice(2, 8)}`;

apiKeyField.value = sessionStorage.getItem(API_KEY_STORAGE) ?? "";
apiKeyField.addEventListener("input", () => {
  sessionStorage.setItem(API_KEY_STORAGE, apiKeyField.value);
});

function say(line: string, fault = false): void {
  const entry = document.createElement("div");
  entry.textContent = `${new Date().toLocaleTimeString("es-AR")}  ${line}`;
  if (fault) entry.className = "fault";
  log.prepend(entry);
}

/** The bearer header when a key has been entered; nothing when it has not, so the 401 says so. */
function authorization(): Record<string, string> {
  const key = apiKeyField.value;
  return key === "" ? {} : { authorization: `Bearer ${key}` };
}

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...authorization() },
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

/**
 * Reads eligibility and reports it. Free — no session, no document, no PIN.
 *
 * Informational only: it answers whether a certificate exists, and a signer
 * with no signature balance still reads as READY_FOR_SIGNING
 * (`docs/research/ADDENDUM-quota.md` §2).
 */
async function readEligibility(email: string, reference: string): Promise<Eligibility> {
  const verdict = (await post("/api/eligibility", { email, reference })) as Eligibility;
  say(`elegibilidad: ${verdict.decision}  nextAction=${verdict.nextAction}`);
  if (verdict.journey !== undefined) say(`journey que abrirá el enlace: ${verdict.journey}`);
  return verdict;
}

check.addEventListener("click", () => {
  const fields = new FormData(form);

  void (async () => {
    try {
      log.replaceChildren();
      await readEligibility(String(fields.get("email")), String(fields.get("reference")));
      say("ojo: la elegibilidad no contempla el saldo de firma");
    } catch (error) {
      say(`error: ${error instanceof Error ? error.message : "desconocido"}`, true);
    }
  })();
});

form.addEventListener("submit", (submission) => {
  submission.preventDefault();
  const fields = new FormData(form);

  void (async () => {
    try {
      log.replaceChildren();
      link.hidden = true;
      say("creando instrumento…");

      const created = (await post("/api/instruments", {
        email: fields.get("email"),
        phone: fields.get("phone"),
        reference: fields.get("reference"),
        montoCentavos: Number(fields.get("pesos")) * 100,
      })) as InstrumentResponse;

      say(`instrumento ${created.instrumentId}  estado ${created.state}`);
      linkAnchor.href = created.signingUrl;
      linkUrl.textContent = created.signingUrl;
      link.hidden = false;
    } catch (error) {
      say(`error: ${error instanceof Error ? error.message : "desconocido"}`, true);
    }
  })();
});
