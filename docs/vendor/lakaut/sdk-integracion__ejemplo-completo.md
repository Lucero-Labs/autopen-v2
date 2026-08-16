<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/ejemplo-completo -->

# Ejemplo completo

Este ejemplo muestra los límites principales. Adaptá autenticación, almacenamiento y framework a tu aplicación.

## Backend

```
import express from "express";
import {
  HttpAuthTransport,
  SessionClient,
  toRendererContext,
} from "@lakaut/server";

const app = express();
app.use(express.json({ limit: "32kb" }));

const sessions = new SessionClient(new HttpAuthTransport({
  baseUrl: process.env.LAKAUT_AUTH_BASE_URL,
  integratorId: process.env.LAKAUT_INTEGRATOR_ID,
  apiKey: process.env.LAKAUT_API_KEY,
  environment: "sandbox",
  compatibility: {
    sdkApiVersion: "1.0.0",
    eventProtocolVersion: "1.0.0",
    webhookSchemaVersion: "1.0.0",
    hostedUiVersion: "1.0.0",
    minimumSdkVersion: "0.1.0-rc.1",
    supportedSdkMajorVersions: [0],
  },
}));

app.post("/api/lakaut/sessions", requireUser, async (req, res) => {
  const application = await applications.findForUser(
    req.body.applicationId,
    req.user.id,
  );

  const identitySubject = application.hasTrustedIdentity
    ? {
        dni: application.dni,
        sexo: application.registeredSex,
      }
    : undefined;

  const created = await sessions.createSession({
    flowType: req.body.flowType,
    allowedOrigin: process.env.APP_PUBLIC_ORIGIN,
    email: req.user.email,
    externalUserRef: application.publicReference,
    ...(identitySubject ? { identitySubject } : {}),
  });

  await applications.bindSdkSession(application.id, created.sessionId);

  res
    .set("cache-control", "no-store")
    .status(201)
    .json({ session: toRendererContext(created) });
});

app.get("/api/lakaut/sessions/:sessionId/status", requireUser, async (req, res) => {
  await applications.assertSessionOwner(req.params.sessionId, req.user.id);
  res.json(await sessions.getSession(req.params.sessionId));
});

app.post("/api/lakaut/sessions/:sessionId/complete", requireUser, async (req, res) => {
  await applications.assertSessionOwner(req.params.sessionId, req.user.id);
  res.json(await sessions.completeSession(req.params.sessionId));
});
```

## Frontend

```
import { HostedUiRenderer } from "@lakaut/browser";

let renderer;

export async function startLakautFlow(applicationId, flowType, pdf) {
  renderer?.destroy();

  const sessionResponse = await fetch("/api/lakaut/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ applicationId, flowType }),
  });
  if (!sessionResponse.ok) throw new Error("session_creation_failed");

  const { session } = await sessionResponse.json();

  renderer = new HostedUiRenderer({
    session,
    container: document.querySelector("#lakaut-hosted-ui"),
    ...(pdf
      ? {
          document: {
            documentId: pdf.id,
            fileName: pdf.name,
            mimeType: "application/pdf",
            bytes: pdf.bytes,
          },
        }
      : {}),
    async onDocumentSigned(artifact) {
      await uploadSignedPdf(applicationId, artifact);
    },
    async on(event) {
      updateUserInterface(event);

      if (event.type === "lakaut.flow.completed") {
        await reconcileWithBackend(session.sessionId);
      }
    },
  });

  renderer.mount();
}
```

## Recepción del PDF

Este endpoint recibe una copia transportada por el browser. Debe autenticar al usuario, limitar tamaño y tipo, recalcular el hash e identificar la operación. No la consideres custodia probatoria hasta verificar el estado autoritativo y, cuando el caso lo exija, la firma CMS y la cadena del certificado en backend.

```
async function uploadSignedPdf(applicationId, artifact) {
  const payload = new FormData();
  payload.append(
    "document",
    new Blob([artifact.bytes], { type: "application/pdf" }),
    artifact.fileName,
  );
  payload.append("documentId", artifact.documentId);
  payload.append("finalPdfHash", artifact.finalPdfHash);

  const response = await fetch(
    `/api/applications/${encodeURIComponent(applicationId)}/signed-document`,
    { method: "POST", body: payload },
  );

  if (!response.ok) throw new Error("signed_document_delivery_failed");
}
```

## Cierre

Después de recibir la copia y reconciliar el resultado autoritativo:

```
await fetch(
  `/api/lakaut/sessions/${encodeURIComponent(sessionId)}/complete`,
  { method: "POST" },
);
```

No completes la sesión desde el browser llamando directamente a Lakaut. El endpoint de cierre pertenece al backend confiable del integrador.
