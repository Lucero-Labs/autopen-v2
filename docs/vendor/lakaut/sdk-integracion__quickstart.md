<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/quickstart -->

# Quickstart

De cero a un titular firmando un documento. Todo lo que es SDK está completo y se copia tal cual. Lo único que ponés vos son las piezas de tu aplicación marcadas como `// TU CÓDIGO`: cómo autenticás a tus usuarios, de dónde sacás el PDF y cómo persistís el resultado.

**Necesitás:** Node.js 20+, una integración asignada en tu panel de Lakaut, y las dos credenciales de [Credenciales y accesos](/documentacion-docusaurus-preprod/docs/sdk-integracion/credenciales).

Para recibir notificaciones server-to-server, completá además [Configurar y rotar el webhook](/documentacion-docusaurus-preprod/docs/sdk-integracion/configurar-webhook).

## 1. Instalar

Con el `.npmrc` ya configurado:

- npm
- pnpm
- Yarn

```
npm install @lakaut/server@0.1.0-rc.34 @lakaut/browser@0.1.0-rc.34
```

```
pnpm add @lakaut/server@0.1.0-rc.34 @lakaut/browser@0.1.0-rc.34
```

```
yarn add @lakaut/server@0.1.0-rc.34 @lakaut/browser@0.1.0-rc.34
```

## 2. Crear la sesión en tu backend

La API key vive acá y solo acá.

server.js

```
import express from "express";
import {
  HttpAuthTransport,
  SessionClient,
  toRendererContext,
} from "@lakaut/server";

const app = express();
app.use(express.json());

const sessions = new SessionClient(
  new HttpAuthTransport({
    integratorId: process.env.LAKAUT_INTEGRATOR_ID,
    apiKey: process.env.LAKAUT_API_KEY,
    baseUrl: process.env.LAKAUT_AUTH_BASE_URL, // en preprod: https://auth-preprod.lakautac.com.ar
    environment: "sandbox",
    compatibility: {
      sdkApiVersion: "1.0.0",
      eventProtocolVersion: "1.0.0",
      webhookSchemaVersion: "1.0.0",
      hostedUiVersion: "1.0.0",
      minimumSdkVersion: "0.1.0-rc.1",
      supportedSdkMajorVersions: [0],
    },
  }),
);

// TU CÓDIGO: el middleware de autenticación de tu app, el que deja `req.user` disponible.
// Este endpoint crea sesiones a nombre de un titular: no lo dejes abierto.
app.post("/api/lakaut/session", requireAuthenticatedUser, async (req, res) => {
  const created = await sessions.createSession({
    flowType: "ONBOARDING_AND_SIGNING",
    allowedOrigin: process.env.LAKAUT_ALLOWED_ORIGIN,
    externalUserRef: req.user.id,
    email: req.user.email,
  });

  // Reduce la salida a lo que el browser puede ver. No armes este objeto a mano.
  res.status(201).json({
    session: toRendererContext(created),
    correlationId: created.correlationId,
  });
});

app.listen(3000);
```

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTIgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTUuMDUuMzFjLjgxIDIuMTcuNDEgMy4zOC0uNTIgNC4zMUMzLjU1IDUuNjcgMS45OCA2LjQ1LjkgNy45OGMtMS40NSAyLjA1LTEuNyA2LjUzIDMuNTMgNy43LTIuMi0xLjE2LTIuNjctNC41Mi0uMy02LjYxLS42MSAyLjAzLjUzIDMuMzMgMS45NCAyLjg2IDEuMzktLjQ3IDIuMy41MyAyLjI3IDEuNjctLjAyLjc4LS4zMSAxLjQ0LTEuMTMgMS44MSAzLjQyLS41OSA0Ljc4LTMuNDIgNC43OC01LjU2IDAtMi44NC0yLjUzLTMuMjItMS4yNS01LjYxLTEuNTIuMTMtMi4wMyAxLjEzLTEuODkgMi43NS4wOSAxLjA4LTEuMDIgMS44LTEuODYgMS4zMy0uNjctLjQxLS42Ni0xLjE5LS4wNi0xLjc4QzguMTggNS4zMSA4LjY4IDIuNDUgNS4wNS4zMkw1LjAzLjNsLjAyLjAxeiIgLz48L3N2Zz4=)</span>Nunca devuelvas la sesión completa

`createSession()` trae campos que no deben salir del backend. `toRendererContext()` los filtra por vos.

El `correlationId` va al lado, no adentro de `session`: no lo necesita la Hosted UI, pero es lo que vas a citar en cualquier reporte a soporte.

## 3. Montar la Hosted UI

checkout.js

```
import { HostedUiRenderer } from "@lakaut/browser";

const { session } = await fetch("/api/lakaut/session", { method: "POST" })
  .then((response) => response.json());

const renderer = new HostedUiRenderer({
  session,
  container: document.getElementById("lakaut"),

  document: {
    documentId: "contrato-4821",
    fileName: "contrato.pdf",
    mimeType: "application/pdf",
    bytes: await cargarPdf(),        // TU CÓDIGO: devuelve el PDF como ArrayBuffer
  },

  async onDocumentSigned(artifact) {
    // El PDF firmado llega acá. Guardalo antes de responder.
    await fetch("/api/lakaut/documento-firmado", {
      method: "POST",
      body: artifact.bytes,
    });
  },

  on(event) {
    switch (event.type) {
      case "lakaut.flow.completed":
        confirmarContraElBackend();  // TU CÓDIGO: llama al endpoint del paso 4
        break;
      case "lakaut.flow.failed":
        mostrarError(event.safeMessage, event.retryable);  // TU CÓDIGO
        break;
    }
  },
});

renderer.mount();
```

La altura del iframe es **fija** (810px, con un mínimo de 680px) — no depende del alto que le des a tu contenedor. Dejale espacio suficiente para evitar que el resto de tu página haga scroll o recorte el iframe.

```
<div id="lakaut"></div>
```

## 4. Confirmar contra tu backend

`lakaut.flow.completed` dice que la **pantalla** terminó. La verdad es el backend:

```
app.get("/api/lakaut/session/:id", async (req, res) => {
  const status = await sessions.getSession(req.params.id);
  res.json({ status: status.status });
});
```

Los eventos del browser pueden perderse, duplicarse o llegar antes que la transición se persista. **Nunca des una operación por cerrada solo por un evento.**

## 5. Recibir el webhook

Para no depender de que el titular deje la pestaña abierta:

webhooks.js

```
import { constructWebhookEvent } from "@lakaut/server";

app.post(
  "/webhooks/lakaut",
  express.raw({ type: "application/json" }),   // el body crudo, sin parsear
  (req, res) => {
    let event;
    try {
      event = constructWebhookEvent(
        req.body,
        req.headers,
        process.env.LAKAUT_WEBHOOK_SECRET,
      );
    } catch {
      return res.status(400).send("invalid signature");
    }

    // TU CÓDIGO: consultá tu tabla de eventos ya procesados
    if (yaProcesado(event.idempotencyKey)) return res.status(200).send("ok");

    if (event.type === "auth.document.signed") {
      // TU CÓDIGO: persistí el resultado
      marcarFirmado(event.sessionId, event.data.documentId);
    }

    res.status(200).send("ok");
  },
);
```

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTIgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTUuMDUuMzFjLjgxIDIuMTcuNDEgMy4zOC0uNTIgNC4zMUMzLjU1IDUuNjcgMS45OCA2LjQ1LjkgNy45OGMtMS40NSAyLjA1LTEuNyA2LjUzIDMuNTMgNy43LTIuMi0xLjE2LTIuNjctNC41Mi0uMy02LjYxLS42MSAyLjAzLjUzIDMuMzMgMS45NCAyLjg2IDEuMzktLjQ3IDIuMy41MyAyLjI3IDEuNjctLjAyLjc4LS4zMSAxLjQ0LTEuMTMgMS44MSAzLjQyLS41OSA0Ljc4LTMuNDIgNC43OC01LjU2IDAtMi44NC0yLjUzLTMuMjItMS4yNS01LjYxLTEuNTIuMTMtMi4wMyAxLjEzLTEuODkgMi43NS4wOSAxLjA4LTEuMDIgMS44LTEuODYgMS4zMy0uNjctLjQxLS42Ni0xLjE5LS4wNi0xLjc4QzguMTggNS4zMSA4LjY4IDIuNDUgNS4wNS4zMkw1LjAzLjNsLjAyLjAxeiIgLz48L3N2Zz4=)</span>El body crudo o la firma no valida

Si un middleware parsea el JSON y lo volvés a serializar, el HMAC cambia. `express.raw()` va **antes** de cualquier `express.json()`.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTQgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTYuMyA1LjY5YS45NDIuOTQyIDAgMCAxLS4yOC0uN2MwLS4yOC4wOS0uNTIuMjgtLjcuMTktLjE4LjQyLS4yOC43LS4yOC4yOCAwIC41Mi4wOS43LjI4LjE4LjE5LjI4LjQyLjI4LjcgMCAuMjgtLjA5LjUyLS4yOC43YTEgMSAwIDAgMS0uNy4zYy0uMjggMC0uNTItLjExLS43LS4zek04IDcuOTljLS4wMi0uMjUtLjExLS40OC0uMzEtLjY5LS4yLS4xOS0uNDItLjMtLjY5LS4zMUg2Yy0uMjcuMDItLjQ4LjEzLS42OS4zMS0uMi4yLS4zLjQ0LS4zMS42OWgxdjNjLjAyLjI3LjExLjUuMzEuNjkuMi4yLjQyLjMxLjY5LjMxaDFjLjI3IDAgLjQ4LS4xMS42OS0uMzEuMi0uMTkuMy0uNDIuMzEtLjY5SDhWNy45OHYuMDF6TTcgMi4zYy0zLjE0IDAtNS43IDIuNTQtNS43IDUuNjggMCAzLjE0IDIuNTYgNS43IDUuNyA1LjdzNS43LTIuNTUgNS43LTUuN2MwLTMuMTUtMi41Ni01LjY5LTUuNy01LjY5di4wMXpNNyAuOThjMy44NiAwIDcgMy4xNCA3IDdzLTMuMTQgNy03IDctNy0zLjEyLTctNyAzLjE0LTcgNy03eiIgLz48L3N2Zz4=)</span>En TypeScript, `event.data` necesita narrowing

`data` está tipado como `Record<string, unknown>`: en JavaScript `event.data.documentId` funciona, pero en TypeScript no compila. Estrechá el tipo antes de usarlo:

```
if (event.type === "auth.document.signed") {
  const { documentId } = event.data as { documentId: string };
  marcarFirmado(event.sessionId, documentId);
}
```

Los webhooks pueden repetirse: `idempotencyKey` viene siempre en el sobre y es la clave con la que tenés que deduplicar. No la confundas con el campo homónimo de `CreateSessionInput`, que no tiene efecto.

## Y listo

Con eso tenés el flujo completo: sesión creada en el backend, Hosted UI montada, confirmación autoritativa y webhook verificado.

## Qué leer después

- [Errores y recuperación](/documentacion-docusaurus-preprod/docs/sdk-integracion/errores) — la única decisión real que vas a tomar: si reintentar sirve o no.
- [Referencia de API](/documentacion-docusaurus-preprod/docs/sdk-integracion/referencia-api) — todas las firmas.
- [Seguridad](/documentacion-docusaurus-preprod/docs/sdk-integracion/seguridad) — antes de ir a producción.
- [Contrato para agentes](/documentacion-docusaurus-preprod/docs/sdk-integracion/agentes) — si integrás con un asistente de programación.
