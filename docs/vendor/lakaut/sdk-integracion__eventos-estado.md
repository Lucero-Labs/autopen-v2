<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/eventos-estado -->

# Eventos, webhooks y estado

## Eventos del navegador

El callback `on` recibe progreso seguro:

```
const renderer = new HostedUiRenderer({
  session,
  container,
  on(event) {
    switch (event.type) {
      case "lakaut.flow.ready":
        break;
      case "lakaut.flow.step_started":
        showCurrentStep(event.step);
        break;
      case "lakaut.flow.step_completed":
        showNextStep(event.nextStep);
        break;
      case "lakaut.flow.failed":
        showSafeError(event.errorCode, event.retryable);
        break;
      case "lakaut.flow.completed":
        refreshAuthoritativeStatus();
        break;
    }
  },
});
```

Eventos disponibles:

| Evento                       | Uso                               |
|------------------------------|-----------------------------------|
| `lakaut.flow.ready`          | Hosted UI quedó inicializada      |
| `lakaut.flow.started`        | Comenzó la experiencia            |
| `lakaut.flow.step_started`   | Comenzó un paso                   |
| `lakaut.flow.step_progress`  | Cambió el estado de un paso       |
| `lakaut.flow.step_completed` | Terminó un paso                   |
| `lakaut.flow.completed`      | La experiencia visual terminó     |
| `lakaut.flow.cancelled`      | El usuario o backend canceló      |
| `lakaut.flow.failed`         | Ocurrió un error seguro           |
| `lakaut.flow.expired`        | Venció la sesión                  |
| `lakaut.flow.closed`         | Se solicitó cerrar la experiencia |

Los payloads no contienen OTP, DNI, email, PIN, token, evidencia biométrica ni PDF.

## Confirmar desde el backend

Después de un evento terminal, consultá:

```
const session = await sessions.getSession(sessionId);
```

Para una firma:

```
const documentStatus = await sessions.getSignedDocumentStatus(
  sessionId,
  documentId,
);
```

El backend es la fuente autoritativa. Los eventos del navegador pueden perderse, duplicarse o llegar antes que una transición persistida.

## Webhooks

Antes de recibir eventos, generá el secreto y verificá el destino como explica [Configurar y rotar el webhook](/documentacion-docusaurus-preprod/docs/sdk-integracion/configurar-webhook). El challenge de activación no es un evento de negocio y usa otros headers y otro material de firma.

Lakaut puede enviar:

```
auth.session.created
auth.session.completed
auth.session.cancelled
auth.session.failed
auth.session.expired
auth.document.signed
otp.challenge.sent
otp.challenge.failed
```

Headers esperados:

```
Content-Type: application/json
Lakaut-Event-Id: <event id>
Lakaut-Event-Type: <event type>
Lakaut-Event-Timestamp: <ISO-8601>
Lakaut-Signature: t=<timestamp>,v1=<signature>
Lakaut-Schema-Version: <version>
```

Tratamiento recomendado:

1.  conservar el body HTTP sin modificar;
2.  verificar firma y timestamp con el secreto server-side;
3.  rechazar eventos inválidos o demasiado antiguos;
4.  deduplicar por `id` o `idempotencyKey`;
5.  persistir el evento;
6.  ejecutar efectos de negocio;
7.  responder 2xx al confirmar la aceptación.

### Verificar la firma

`@lakaut/server` trae el verificador. No implementes el HMAC a mano:

```
import { constructWebhookEvent } from "@lakaut/server";

app.post(
  "/webhooks/lakaut",
  express.raw({ type: "application/json" }),
  (req, res) => {
    let event;
    try {
      event = constructWebhookEvent(
        req.body,                       // Buffer crudo, sin parsear
        req.headers,
        process.env.LAKAUT_WEBHOOK_SECRET,
      );
    } catch (error) {
      return res.status(400).send("invalid signature");
    }

    // ya verificado: deduplicar por event.idempotencyKey y procesar
    res.status(200).send("ok");
  },
);
```

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTIgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTUuMDUuMzFjLjgxIDIuMTcuNDEgMy4zOC0uNTIgNC4zMUMzLjU1IDUuNjcgMS45OCA2LjQ1LjkgNy45OGMtMS40NSAyLjA1LTEuNyA2LjUzIDMuNTMgNy43LTIuMi0xLjE2LTIuNjctNC41Mi0uMy02LjYxLS42MSAyLjAzLjUzIDMuMzMgMS45NCAyLjg2IDEuMzktLjQ3IDIuMy41MyAyLjI3IDEuNjctLjAyLjc4LS4zMSAxLjQ0LTEuMTMgMS44MSAzLjQyLS41OSA0Ljc4LTMuNDIgNC43OC01LjU2IDAtMi44NC0yLjUzLTMuMjItMS4yNS01LjYxLTEuNTIuMTMtMi4wMyAxLjEzLTEuODkgMi43NS4wOSAxLjA4LTEuMDIgMS44LTEuODYgMS4zMy0uNjctLjQxLS42Ni0xLjE5LS4wNi0xLjc4QzguMTggNS4zMSA4LjY4IDIuNDUgNS4wNS4zMkw1LjAzLjNsLjAyLjAxeiIgLz48L3N2Zz4=)</span>El body tiene que ser el crudo

Si tu framework parsea el JSON y lo volvés a serializar, la firma **no valida**: un espacio o un reordenamiento de claves cambia el HMAC. Usá `express.raw()` o el equivalente de tu stack antes de cualquier middleware que parsee JSON.

Si necesitás verificar sin el SDK, el cálculo es:

```
HMAC-SHA256(secreto, `${timestamp}.${eventId}.${rawBody}`)
```

en hexadecimal minúscula, comparado en tiempo constante contra el valor `v1=` del header `Lakaut-Signature`. El `timestamp` es el valor `t=` del mismo header y debe coincidir con `Lakaut-Event-Timestamp`. La tolerancia por defecto es de **300 segundos**: rechazá lo que quede fuera de esa ventana.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>`t=` es un instante ISO-8601, no epoch de Stripe

El header tiene la misma forma que el de Stripe (`t=...,v1=...`), pero **no** es el mismo esquema: `t=` no es epoch en segundos, es un timestamp ISO-8601 (`2026-08-12T14:39:00.123Z`). Si armás la verificación a mano, parseá `t=` como fecha ISO-8601 antes de compararlo contra el momento actual — tratarlo como epoch numérico rompe la ventana de tolerancia. `constructWebhookEvent()` ya maneja esto, es otra razón para usarlo en vez de reimplementar la verificación.

## Constancia de documento firmado 1.1 y 1.2

Sin opt-in, `auth.document.signed` conserva el contrato inmediato `1.1.0`:

```
{
  "type": "auth.document.signed",
  "version": "1.1.0",
  "sessionId": "SESSION_ID",
  "finalStatus": "SIGNED",
  "data": {
    "documentId": "contract-42",
    "signedContentHash": "HASH_HEXADECIMAL",
    "algorithm": "SHA-256",
    "signedAt": "2026-07-24T18:00:00Z",
    "certificateRef": "CERTIFICATE_REFERENCE"
  }
}
```

El webhook nunca transporta el PDF ni la firma CMS.

Con el opt-in `capabilities: ["signed-document-reconciliation:1.2"]`, Lakaut espera que tu backend verifique, custodie y registre el binding del mismo artefacto. Recién en estado `BOUND` emite:

```
{
  "type": "auth.document.signed",
  "version": "1.2.0",
  "sessionId": "SESSION_ID",
  "finalStatus": "SIGNED",
  "data": {
    "documentId": "contract-42",
    "signedContentHash": "HASH_CONTENIDO_FIRMADO",
    "finalPdfHash": "HASH_PDF_FINAL",
    "algorithm": "SHA-256",
    "signedAt": "2026-08-19T18:00:00Z",
    "artifactBindingStatus": "BOUND",
    "bindingId": "6ff38b26-74aa-4a43-a465-2cb9db1cbca7"
  }
}
```

`signedContentHash` es evidencia del contenido autorizado por Lakaut. `finalPdfHash` identifica los bytes finales que el integrador verificó, custodió y vinculó por el canal server-to-server. Auth no recibe el PDF ni afirma haber recalculado ese hash.

No se emiten 1.1 y 1.2 para la misma firma. Sin opt-in permanece 1.1 y no se inventa un backfill para receipts anteriores. Durante la migración, el receptor nuevo debe aceptar ambos contratos.

## Reintentos

La entrega de webhooks puede repetirse. El `id` y la `idempotencyKey` permanecen estables para la misma transición de negocio. Tu consumidor debe ser idempotente.

Cada intento usa como una unidad inmutable el destino y el secreto vigentes: no puede mezclar una URL anterior con una clave nueva. Una vez activada una rotación, los reintentos pendientes se envían al nuevo destino y se firman con el nuevo secreto.
