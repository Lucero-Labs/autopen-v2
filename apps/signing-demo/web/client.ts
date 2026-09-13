/**
 * The browser half: collect a plan, mount the ceremony, deliver what comes back.
 *
 * No `@lakaut/*` import appears here. The renderer lives behind
 * `@autopen/adapter-lakaut/browser` for the same reason the session client does
 * (STYLES §2), so this file speaks only in the core's vocabulary.
 *
 * `lakaut.flow.completed` moves the UI and nothing else: the success line is
 * written only after the backend has read the provider's own record
 * (STYLES §9.1).
 */

import { mountCeremony, type MountedCeremony } from "@autopen/adapter-lakaut/browser";
import type { CeremonyHandoff, ContentHash, DocumentId, SealedDocument } from "@autopen/core";

interface OpenResponse {
  readonly handoff: CeremonyHandoff;
  readonly ceremonyId: string;
  readonly fileName: string;
  readonly document: {
    readonly documentId: string;
    readonly contentHash: string;
    readonly bytesBase64: string;
    readonly sealedAt: string;
  };
}

const form = document.querySelector("#plan") as HTMLFormElement;
const container = document.querySelector("#lakaut-hosted-ui") as HTMLElement;
const log = document.querySelector("#log") as HTMLElement;
const check = document.querySelector("#check") as HTMLButtonElement;

let mounted: MountedCeremony | undefined;

function say(line: string, fault = false): void {
  const entry = document.createElement("div");
  entry.textContent = `${new Date().toLocaleTimeString("es-AR")}  ${line}`;
  if (fault) entry.className = "fault";
  log.prepend(entry);
}

/**
 * Refuses to mount into an origin the session was not issued for.
 *
 * The Hosted UI declines to be framed by anything other than the session's
 * `allowedOrigin`, and the browser reports that as a bare "refused to connect"
 * inside an empty iframe — a message that names neither origin and points at
 * Lakaut rather than at the mismatch. The session is created successfully
 * beforehand, because the API validates the origin it is *given*, not the one
 * the page turns out to be served from.
 *
 * So check it here, where both values are known, and say which is which.
 */
function assertOriginMatches(handoff: CeremonyHandoff): void {
  const issuedFor = handoff.context.allowedOrigin;
  if (typeof issuedFor !== "string") return;

  if (issuedFor !== window.location.origin) {
    throw new Error(
      `la sesión se abrió para ${issuedFor} pero la página está en ` +
        `${window.location.origin}. Poné LAKAUT_ALLOWED_ORIGIN en ese valor, ` +
        "declaralo en el dashboard, y reiniciá el servidor.",
    );
  }
}

function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
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

async function reconcile(ceremonyId: string): Promise<void> {
  const response = await fetch(`/api/ceremonies/${ceremonyId}`);
  const status = (await response.json()) as {
    readonly state?: string;
    readonly correlationId?: string;
    readonly error?: string;
  };
  say(
    status.error !== undefined
      ? `no se pudo leer el estado: ${status.error}`
      : `estado autoritativo: ${status.state}  correlationId=${status.correlationId}`,
  );
}

/**
 * Asks the provider which journey this signer needs, and selects it.
 *
 * Free — no session, no document, no PIN. It answers whether a certificate
 * exists and nothing more: a signer with no signature balance still reads as
 * READY_FOR_SIGNING, so a green answer here does not promise the ceremony can
 * finish (docs/research/ADDENDUM-quota.md).
 */
check.addEventListener("click", () => {
  const fields = new FormData(form);

  void (async () => {
    try {
      const verdict = (await post("/api/eligibility", {
        email: fields.get("email"),
        reference: fields.get("reference"),
      })) as {
        readonly decision: string;
        readonly journey?: string;
        readonly nextAction: string;
        readonly correlationId: string;
      };

      say(`elegibilidad: ${verdict.decision}  nextAction=${verdict.nextAction}`);

      if (verdict.journey !== undefined) {
        const select = form.elements.namedItem("journey") as HTMLSelectElement;
        select.value = verdict.journey;
        say(`journey seleccionado: ${verdict.journey}`);

        // The only pairing the catalogue allows for onboarding is email+sms,
        // whose required inputs are EMAIL and PHONE.
        if (verdict.journey === "onboarding-and-signing") {
          (form.elements.namedItem("factors") as HTMLSelectElement).value = "email-and-sms";
          say("factors ajustado a email-and-sms — onboarding exige email y teléfono");
        }
      }

      say(
        "ojo: la elegibilidad no contempla el saldo de firma",
        verdict.decision === "READY_FOR_SIGNING",
      );
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
      mounted?.destroy();
      log.replaceChildren();
      say("abriendo ceremonia…");

      const opened = (await post("/api/ceremonies", {
        journey: fields.get("journey"),
        factors: fields.get("factors"),
        email: fields.get("email"),
        phone: fields.get("phone"),
        reference: fields.get("reference"),
        montoCentavos: Number(fields.get("pesos")) * 100,
      })) as OpenResponse;

      say(`sesión ${opened.ceremonyId}  documento ${opened.document.documentId}`);
      assertOriginMatches(opened.handoff);

      const sealed: SealedDocument = {
        documentId: opened.document.documentId as DocumentId,
        contentHash: opened.document.contentHash as ContentHash,
        bytes: bytesFromBase64(opened.document.bytesBase64),
        sealedAt: opened.document.sealedAt,
      };

      mounted = mountCeremony({
        handoff: opened.handoff,
        container,
        document: sealed,
        fileName: opened.fileName,
        language: "es",
        onEvent: (event) => {
          const detail = [
            event.step !== undefined ? `step=${event.step}` : "",
            event.errorCode !== undefined ? `errorCode=${event.errorCode}` : "",
            event.retryable !== undefined ? `retryable=${String(event.retryable)}` : "",
            event.disposition !== undefined ? `disposition=${event.disposition}` : "",
            event.safeMessage ?? "",
          ]
            .filter((part) => part !== "")
            .join("  ");

          say(`${event.type}  ${detail}`.trimEnd(), event.type === "lakaut.flow.failed");
          // The visual experience ending is a cue to go and read the record,
          // never a conclusion in itself.
          if (event.type === "lakaut.flow.completed" || event.type === "lakaut.flow.failed") {
            void reconcile(opened.ceremonyId);
          }
        },
        onSigned: async (delivery) => {
          say("firmado en el navegador — verificando contra el backend");
          const verified = (await post("/api/deliveries", {
            ceremonyId: delivery.ceremonyId,
            documentId: delivery.documentId,
            fileName: delivery.fileName,
            bytesBase64: base64FromBytes(delivery.bytes),
            signedContentHash: delivery.signedContentHash,
            finalPdfHash: delivery.finalPdfHash,
            signedAt: delivery.signedAt,
          })) as { readonly archivedTo: string };
          say(`verificado y archivado en ${verified.archivedTo}`);
        },
      });
    } catch (error) {
      say(`error: ${error instanceof Error ? error.message : "desconocido"}`, true);
    }
  })();
});
