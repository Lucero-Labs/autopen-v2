<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/agentes -->

# Contrato para agentes de código

Esta página está escrita para que un asistente de programación integre el SDK sin inventar nada. Es autocontenida: contiene el contrato completo, en un formato pensado para pegarse en el contexto de un agente.

También está disponible como texto plano en <a href="/documentacion-docusaurus-preprod/assets/files/llms-623d739f54bfc12d771c79b82d2c267e.txt" target="_blank"><code>/llms.txt</code></a>.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTIgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTYuNSAwQzMuNDggMCAxIDIuMTkgMSA1YzAgLjkyLjU1IDIuMjUgMSAzIDEuMzQgMi4yNSAxLjc4IDIuNzggMiA0djFoNXYtMWMuMjItMS4yMi42Ni0xLjc1IDItNCAuNDUtLjc1IDEtMi4wOCAxLTMgMC0yLjgxLTIuNDgtNS01LjUtNXptMy42NCA3LjQ4Yy0uMjUuNDQtLjQ3LjgtLjY3IDEuMTEtLjg2IDEuNDEtMS4yNSAyLjA2LTEuNDUgMy4yMy0uMDIuMDUtLjAyLjExLS4wMi4xN0g1YzAtLjA2IDAtLjEzLS4wMi0uMTctLjItMS4xNy0uNTktMS44My0xLjQ1LTMuMjMtLjItLjMxLS40Mi0uNjctLjY3LTEuMTFDMi40NCA2Ljc4IDIgNS42NSAyIDVjMC0yLjIgMi4wMi00IDQuNS00IDEuMjIgMCAyLjM2LjQyIDMuMjIgMS4xOUMxMC41NSAyLjk0IDExIDMuOTQgMTEgNWMwIC42Ni0uNDQgMS43OC0uODYgMi40OHpNNCAxNGg1Yy0uMjMgMS4xNC0xLjMgMi0yLjUgMnMtMi4yNy0uODYtMi41LTJ6IiAvPjwvc3ZnPg==)</span>Cómo usarla

Pegale a tu agente el contenido de esta página, o pasale la URL. Todo lo que necesita —endpoints, headers, códigos de error, reglas de seguridad— está acá abajo.

## Reglas que no se negocian

1.  **La API key nunca sale del backend.** No va en el bundle del frontend, ni en una respuesta de la API del integrador, ni en logs del cliente. El SDK rechaza `apiKey`, `x-api-key` y `X-API-Key` entre los datos que se le pasan al renderer.
2.  **El browser recibe exactamente lo que devuelve `toRendererContext()`**, ni más ni menos. Ese objeto es un `SessionForRenderer` y lleva `sessionId`, `clientToken`, `clientTokenExpiresAt`, **`hostedUiOrigin`** (un origen, no una URL), `allowedOrigin`, `environment` y, si están, `flowConfig`, `email`, `phone` e `identitySubjectStatus`. No existe un campo `hostedUiUrl` en el contexto del renderer: `hostedUiUrl` es de la respuesta HTTP cruda de Auth, y el SDK la reduce a su origen.
3.  **Nunca se construyen mensajes `postMessage` a mano.** Se usa `HostedUiRenderer`.
4.  **La verdad final es el backend**, no los eventos del browser. Los eventos pueden perderse o duplicarse; antes de dar por cerrada una operación hay que confirmarla contra la API o contra el webhook.
5.  **Nunca se loguea**: API key, `clientToken`, OTP, DNI, sexo, PIN, PDF, evidencia biométrica ni JWT.
6.  **Versiones exactas.** Sin `latest`, sin rangos, sin dependencias Git.
7.  **El secreto de webhook vive solo en backend.** Se genera y rota desde el dashboard; el challenge de activación no se verifica con `constructWebhookEvent()`.

## Paquetes

```
npm install @lakaut/server@0.1.0-rc.34 @lakaut/browser@0.1.0-rc.34
```

| Paquete                    | Dónde corre                                  |
|----------------------------|----------------------------------------------|
| `@lakaut/server`           | Backend del integrador                       |
| `@lakaut/browser`          | Navegador                                    |
| `@lakaut/shared-contracts` | Tipos compartidos; llega de forma transitiva |

No existe un paquete `@lakaut/sdk`. Los canales publicados son `dev` y `preprod`; para una integración estable, fijá la versión exacta en el lockfile en vez del canal.

## Autenticación

Dos credenciales, dos superficies:

| Credencial | Headers | Dónde |
|----|----|----|
| API key | `X-Integrator-Id: <slug>` + `X-API-Key: <secreto>` | Backend |
| Credencial efímera | `Authorization: Bearer <clientToken>` + `Origin: <origen exacto>` | Hosted UI |

La Hosted UI renueva su credencial sola al 70 % de la vida útil. El integrador no implementa esa renovación.

## Endpoints del backend

Todos con `X-Integrator-Id` + `X-API-Key`.

### Crear sesión

```
POST /v1/sdk/sessions
Content-Type: application/json
```

Cuerpo — `allowedOrigin` es el único campo obligatorio:

```
{
  "flowType": "PASSWORDLESS_AUTH | ONBOARDING | SIGNING | ONBOARDING_AND_SIGNING",
  "allowedOrigin": "https://portal.miempresa.com",
  "externalUserRef": "cliente-4821",
  "email": "titular@ejemplo.com",
  "phone": "+5491122334455",
  "identitySubject": { "dni": "30111222", "sexo": "F" },
  "journeyId": "...",
  "authenticationProfileId": "...",
  "returnUrl": "...",
  "cancelUrl": "...",
  "continuationFromSessionId": "<uuid>"
}
```

Campos que **no existen** en este endpoint: `idempotencyKey`, `clientContext` y `requestedTtlSeconds`. El servidor ignora en silencio cualquier propiedad desconocida —no devuelve `400`—, así que mandarlos no falla pero tampoco hace nada.

Recorrido y perfil:

- Mandá `flowType` **o** `journeyId`. Si mandás los dos y pertenecen a familias distintas, es `400 INVALID_REQUEST`.
- Si omitís `authenticationProfileId`, el default depende de **cómo** elegiste el recorrido: con `journeyId` sale el default del journey; con `flowType` (haya o no `journeyId`) sale siempre `auth.email-sms.v1`. Hoy solo se nota en firma: `{"journeyId":"journey.signing.v1"}` resuelve `auth.email.v1`, mientras que `{"flowType":"SIGNING"}` resuelve `auth.email-sms.v1`.
- `auth.sms.v1` exige **`email` y `phone` juntos**, aunque el OTP viaje por SMS: el email es el sujeto server-bound del perfil. Si falta cualquiera de los dos, es `400 INVALID_REQUEST`.
- `journey.onboarding.v1` y `journey.onboarding-signing.v1` solo admiten `auth.email-sms.v1`. `journey.login.v1` y `journey.signing.v1` admiten los tres perfiles.

Consultá `GET /v1/sdk/catalog` en vez de hardcodear estas combinaciones: devuelve los journeys, los perfiles y la lista de `allowedCombinations` habilitados para tu integración.

Respuesta `201`:

```
{
  "sessionId": "<uuid>",
  "clientToken": "<uuid>.<base64url>",
  "hostedUiUrl": "https://<host>/hosted-ui.html",
  "expiresInSeconds": 1800,
  "correlationId": "sdk_<uuid>",
  "journeyId": "journey.onboarding-signing.v1",
  "journeyVersion": 1,
  "authenticationProfileId": "auth.email-sms.v1",
  "authenticationProfileVersion": 1,
  "requiredInputs": ["EMAIL", "PHONE"],
  "initialStep": "document_review",
  "identitySubjectStatus": "required",
  "flow_config": {
    "flowKind": "onboarding_and_signing",
    "vocabularyVersion": "1.1.0",
    "steps": [{ "type": "email_otp", "required": true }]
  }
}
```

`flow_config` es el único snake_case del nivel raíz; todo lo demás es camelCase. `correlationId` siempre arranca con `sdk_`.

Presencia de cada campo:

- Siempre: `sessionId`, `clientToken`, `hostedUiUrl`, `expiresInSeconds`, `correlationId`, `journeyId`, `journeyVersion`, `authenticationProfileId`, `authenticationProfileVersion`, `requiredInputs`, `flow_config`.
- `initialStep`: **solo** si mandaste `continuationFromSessionId`.
- `identitySubjectStatus`: solo si el recorrido incluye onboarding. Vale `"provided"` o `"required"`, en **minúscula** — es el único valor minúsculo del 201 junto con los `type` de `flow_config.steps` y el propio `initialStep`.
- Los campos nulos se omiten (`@JsonInclude(NON_NULL)`). El `GET .../status`, en cambio, **sí** serializa `null`.

`requiredInputs` viene en **MAYÚSCULA** (`"EMAIL"`, `"PHONE"`), siempre con `EMAIL` primero. `flow_config.flowKind` está siempre presente y vale `passwordless_login`, `onboarding_certificate`, `document_signing` u `onboarding_and_signing`.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>`expiresInSeconds` no es la vida de la sesión

Es el TTL de la **credencial efímera del browser** (`clientToken`). La respuesta `201` no expone en ningún campo cuándo vence la sesión de negocio. El valor depende del ambiente —no lo hardcodees—: hoy son 30 minutos en dev/local, 90 en preproducción y 15 minutos como default del servicio cuando nadie lo configura.

### Resto

| Método | Path | Para qué |
|----|----|----|
| `GET` | `/v1/sdk/catalog` | Journeys y perfiles disponibles |
| `GET` | `/v1/sdk/sessions/{sessionId}/status` | Estado autoritativo |
| `POST` | `/v1/sdk/sessions/{sessionId}/complete` | Cerrar la sesión |
| `POST` | `/v1/sdk/sessions/{sessionId}/cancel` | Cancelar |
| `GET` | `/v1/sdk/sessions/{sessionId}/documents/{documentId}/status` | Estado del documento firmado |

`documentId` debe matchear `^[A-Za-z0-9._:-]{1,120}$`. Si no matchea, la respuesta es `404` con código `FORBIDDEN` — no `400`.

Dos excepciones a "todos con `X-Integrator-Id` + `X-API-Key`":

- `POST /v1/sdk/sessions/{sessionId}/client-credential/refresh` se autentica con `Authorization: Bearer {clientToken}` y **no** acepta la API key. Lo llama la Hosted UI sola; el integrador no lo implementa.
- En `documents/{documentId}/status`, si faltan los headers la respuesta es `400` (*Missing request header*), no el `401 UNAUTHORIZED` homogéneo del resto. Es el único endpoint del set que no pasa por el filtro de presencia de headers.

`complete` devuelve `409` con código `session_not_ready` —en minúscula, es el único **código de error** minúsculo del contrato— si la sesión todavía no está lista. Ojo: en `GET .../status` el campo `errorCode` sale siempre en MAYÚSCULA, incluso para este caso (`SESSION_NOT_READY`).

## Montar la Hosted UI

```
import { HostedUiRenderer } from "@lakaut/browser";

// `session` es exactamente lo que devolvió toRendererContext() en el backend.
// No armes este objeto a mano ni pases sessionId/clientToken sueltos.
const renderer = new HostedUiRenderer({
  session,
  container: document.getElementById("lakaut-container")!,
  on: (event) => {
    switch (event.type) {
      case "lakaut.flow.completed":
        // confirmar SIEMPRE contra el backend antes de dar por cerrado
        break;
      case "lakaut.flow.failed":
        showSafeError(event.errorCode, event.retryable);
        break;
    }
  },
});

renderer.mount();
// al desmontar el componente:
renderer.destroy();
```

El iframe necesita `allow="camera; microphone"` para el paso de identidad, y el sitio debe servirse por HTTPS.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>`toRendererContext()` no copia todo lo que `SessionForRenderer` admite

Copia `sessionId`, `clientToken`, `clientTokenExpiresAt`, `hostedUiOrigin`, `allowedOrigin`, `environment`, `flowConfig`, `email`, `phone` e `identitySubjectStatus`. **No** copia `flowKind`, `requiredInputs`, `journeyId`, `journeyVersion`, `authenticationProfileId` ni `authenticationProfileVersion`, aunque el tipo los acepte y `mount()` los reenvíe en el `hosted_ui.init`.

Todos esos campos son opcionales en el handshake: el flujo monta igual sin ellos, y `flow_config.flowKind` viaja de todas formas dentro de `flowConfig`. Si tu caso necesita alguno arriba en el objeto, agregalo explícitamente **sobre** el resultado de `toRendererContext()` —nunca armando el objeto desde cero— y sin inventar defaults.

### Eventos

`lakaut.flow.` + `ready`, `started`, `step_started`, `step_progress`, `step_completed`, `completed`, `cancelled`, `failed`, `expired`, `closed`.

## Clasificación de errores

Tres categorías. La decisión es siempre la misma: ¿reintentar sirve?

| Categoría | Acción |
|----|----|
| `retry-in-step` | Dejar al titular reintentar en el paso. **No** recrear la sesión |
| `terminal` | Terminar con salida explícita |
| `session-recovery` | Crear una sesión nueva |

Un código desconocido se trata como `retry-in-step`. Ese es el default seguro y no debe cambiarse.

**terminal**: `UNAUTHORIZED`, `FORBIDDEN`, `FORBIDDEN_ORIGIN`, `INTEGRATOR_DISABLED`, `INTEGRATOR_ROUTED_TO_LEGACY`, `UNSUPPORTED_VERSION`, `FLOW_CONFIG_INVALID`, `IDENTITY_SUBJECT_CONFLICT`, `CERTIFICATE_IDENTITY_NOT_APPROVED`, `CERTIFICATE_IDENTITY_MISMATCH`, `CERTIFICATE_INVALID_REQUEST`, `SIGN_QUOTA_EXHAUSTED`, `SIGN_DOCUMENT_CONFLICT`.

**session-recovery**: `SESSION_NOT_FOUND`, `SESSION_EXPIRED`, `SESSION_TERMINAL`, `INVALID_CLIENT_CREDENTIAL`, `EXPIRED_CLIENT_CREDENTIAL`, `REVOKED_CLIENT_CREDENTIAL`.

**Todo el resto es `retry-in-step`**, incluidos `CERTIFICATE_NOT_AVAILABLE`, `SIGN_PIN_INVALID`, `OTP_INVALID` y `RATE_LIMITED`.

La lista completa con su significado está en [Errores y recuperación](/documentacion-docusaurus-preprod/docs/sdk-integracion/errores).

**Decidí por el código, no por el status HTTP.** El mismo código sale con distinto status según el endpoint.

### Reintento dentro del paso

Conservar sesión, documento y paso. Borrar solo el PIN. Impedir el doble envío. Nunca hacer repetir OTP, identidad ni certificado.

## Webhooks

El alta, la entrega de una sola lectura, el challenge y la rotación están documentados en [Configurar y rotar el webhook](/documentacion-docusaurus-preprod/docs/sdk-integracion/configurar-webhook). No uses `constructWebhookEvent()` para el challenge: el helper es solo para los eventos de negocio que siguen.

Headers que envía Lakaut:

```
Lakaut-Event-Id: <uuid>
Lakaut-Event-Type: auth.session.completed
Lakaut-Event-Timestamp: <ISO-8601>
Lakaut-Signature: t=<timestamp>,v1=<hmac-sha256-hex>
Lakaut-Schema-Version: 1.1.0
```

Verificación:

```
import { constructWebhookEvent } from "@lakaut/server";

// rawBody TIENE que ser el cuerpo sin parsear ni re-serializar
const event = constructWebhookEvent(rawBody, headers, webhookSecret);
```

El HMAC-SHA256 se calcula sobre `` `${timestamp}.${eventId}.${rawBody}` `` con el secreto en UTF-8, en hex minúscula. La tolerancia de timestamp por defecto es de 300 segundos.

Tipos de evento: `auth.session.created`, `auth.session.completed`, `auth.session.cancelled`, `auth.session.failed`, `auth.session.expired`, `auth.document.signed`, `otp.challenge.sent`, `otp.challenge.failed`.

Los webhooks pueden repetirse: el manejo tiene que ser idempotente por `idempotencyKey`.

## Documentos firmados

Si llega `signed_document_delivery_failed`, **el documento ya está firmado**. No volver a firmarlo: reconciliar consultando el estado del documento desde el backend.

## Errores frecuentes al integrar

| Síntoma | Causa |
|----|----|
| `403 FORBIDDEN_ORIGIN` | El `Origin` no coincide con el `allowedOrigin` de la sesión |
| La cámara no abre | Falta `allow="camera; microphone"` en el iframe, o el sitio no es HTTPS |
| La firma del webhook no valida | Se parseó y re-serializó el body en vez de usar el raw |
| `401` al instalar | `LAKAUT_NPM_AUTH` mal inyectado en `.npmrc` |
| El flujo vuelve al primer paso | Se recreó la sesión ante un error `retry-in-step` |
