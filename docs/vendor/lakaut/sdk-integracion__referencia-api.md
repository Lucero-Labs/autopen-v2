<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/referencia-api -->

# Referencia de API

Todo lo que exportan los paquetes, con las firmas exactas.

## `@lakaut/server`

Corre en tu backend. Es el único que conoce la API key.

### `HttpAuthTransport`

El transporte HTTP contra la API de Lakaut. Guarda las credenciales y agrega los headers de cada llamada.

```
new HttpAuthTransport(config: HttpAuthTransportConfig)
```

```
interface HttpAuthTransportConfig {
  integratorId: string;
  apiKey: string;
  baseUrl: string;
  environment: LakautEnvironment;      // "local" | "sandbox" | "production"
  compatibility: CompatibilityMetadata;
}
```

```
interface CompatibilityMetadata {
  sdkApiVersion: string;
  eventProtocolVersion: string;
  webhookSchemaVersion: string;
  hostedUiVersion: string;
  minimumSdkVersion: string;
  supportedSdkMajorVersions: number[];
}
```

`minimumSdkVersion` es el piso que declarás vos: la versión más vieja del SDK con la que tu integración funciona. No lo subas en cada release — solo cuando dejes de soportar versiones anteriores. Hoy el SDK no lo valida más allá de exigir un string no vacío, pero es el campo del que va a depender la negociación de compatibilidad.

Solo `completeSession` y `cancelSession` lanzan `AuthTransportError` (con `code` y `status`) ante un error HTTP. `createSession`, `getSession`, `getCatalog` y `getSignedDocumentStatus` lanzan un `Error` genérico — no asumas `.code`/`.status` en esos cuatro, o tu manejo de errores no va a capturar nada útil.

### `SessionClient`

La superficie que vas a usar. Recibe un transporte y expone seis operaciones:

```
new SessionClient(transport: AuthTransport)
```

| Método | Devuelve |
|----|----|
| `createSession(input: CreateSessionInput)` | `Promise<CreateSessionOutput>` |
| `getSession(sessionId: string)` | `Promise<AuthoritativeSessionStatus>` |
| `completeSession(sessionId: string)` | `Promise<AuthoritativeSessionStatus>` |
| `cancelSession(sessionId: string)` | `Promise<AuthoritativeSessionStatus>` |
| `getSignedDocumentStatus(sessionId, documentId)` | `Promise<SignedDocumentStatus>` |
| `getCatalog()` | `Promise<JourneyCatalogSnapshot>` |

`getCatalog()` es la respuesta a *"¿qué `journeyId` y `authenticationProfileId` puedo usar?"*. Devuelve lo que tu integración tiene habilitado, sin que tengas que hardcodear la matriz:

```
interface JourneyCatalogSnapshot {
  catalogVersion: string;             // "1" — string, no número
  vocabularyVersion: string;          // "1.1.0"
  journeys: readonly {
    id; version; displayName; flowKind; legacyFlowType; defaultAuthenticationProfileId;
  }[];
  authenticationProfiles: readonly {
    id; version; displayName; factors; requiredInputs; requiresServerBoundIdentity;
  }[];
  allowedCombinations: readonly {
    journeyId; journeyVersion; authenticationProfileId; authenticationProfileVersion;
  }[];
}
```

Nunca expone la regla de evidencia ni el grafo de ejecución del recorrido.

#### `CreateSessionInput`

```
interface CreateSessionInput {
  allowedOrigin: string;                 // único obligatorio
  flowType?: SdkFlowType;
  journeyId?: JourneyId;
  authenticationProfileId?: AuthenticationProfileId;
  externalUserRef?: string;
  email?: string;
  phone?: string;
  identitySubject?: IdentitySubject;     // server-side only
  returnUrl?: string;
  cancelUrl?: string;
  continuationFromSessionId?: string;    // server-side only

  // Declarados en el tipo, pero el transporte NO los envía — ver abajo
  clientContext?: Record<string, unknown>;
  idempotencyKey?: string;
  requestedTtlSeconds?: number;
}
```

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTIgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTUuMDUuMzFjLjgxIDIuMTcuNDEgMy4zOC0uNTIgNC4zMUMzLjU1IDUuNjcgMS45OCA2LjQ1LjkgNy45OGMtMS40NSAyLjA1LTEuNyA2LjUzIDMuNTMgNy43LTIuMi0xLjE2LTIuNjctNC41Mi0uMy02LjYxLS42MSAyLjAzLjUzIDMuMzMgMS45NCAyLjg2IDEuMzktLjQ3IDIuMy41MyAyLjI3IDEuNjctLjAyLjc4LS4zMSAxLjQ0LTEuMTMgMS44MSAzLjQyLS41OSA0Ljc4LTMuNDIgNC43OC01LjU2IDAtMi44NC0yLjUzLTMuMjItMS4yNS01LjYxLTEuNTIuMTMtMi4wMyAxLjEzLTEuODkgMi43NS4wOSAxLjA4LTEuMDIgMS44LTEuODYgMS4zMy0uNjctLjQxLS42Ni0xLjE5LS4wNi0xLjc4QzguMTggNS4zMSA4LjY4IDIuNDUgNS4wNS4zMkw1LjAzLjNsLjAyLjAxeiIgLz48L3N2Zz4=)</span>Dos campos que nunca van al browser

`identitySubject` y `continuationFromSessionId` son server-side. Copiarlos al contexto del renderer expone datos del titular y un handoff de autenticación.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>Tres campos sin efecto

`clientContext`, `idempotencyKey` y `requestedTtlSeconds` siguen en el tipo por compatibilidad, pero `HttpAuthTransport.createSession` no los serializa y el backend no los reconoce. Se validan y se descartan: `idempotencyKey` **no** evita sesiones duplicadas y `clientContext` **no** vuelve en los eventos. Resolvé idempotencia en tu endpoint y correlacioná con `externalUserRef` y `correlationId`.

`flowType` acepta `PASSWORDLESS_AUTH`, `ONBOARDING`, `SIGNING` u `ONBOARDING_AND_SIGNING`.

Con el perfil `auth.sms.v1`, `email` y `phone` pasan a ser obligatorios: `validateCreateSessionInput` lanza `"SMS-only authentication requires server-bound email and phone"` si falta alguno.

#### `CreateSessionOutput`

```
interface CreateSessionOutput {
  sessionId: string;
  clientToken: string;
  expiresAt: string;                     // ISO-8601 absoluto
  hostedUiOrigin: string;                // origen, no URL completa
  allowedOrigin: string;
  environment: LakautEnvironment;
  eventProtocolVersion: string;
  hostedUiVersion: string;
  allowedModes: readonly ["iframe"];
  flowKind?: FlowKind;
  flow_config?: FlowConfig;              // como llega de Auth; normalizado a flowConfig
  flowConfig?: FlowConfig;
  correlationId?: string;
  flowType?: SdkFlowType;
  journeyId?: JourneyId;
  journeyVersion?: number;
  authenticationProfileId?: AuthenticationProfileId;
  authenticationProfileVersion?: number;
  requiredInputs?: readonly AuthenticationInput[];
  email?: string;
  phone?: string;
  identitySubjectStatus?: IdentitySubjectStatus;
}
```

Usá siempre `flowConfig` (camelCase); `flow_config` es el nombre en el que llega desde Auth y solo está para casos donde accedas a la respuesta cruda.

### `toRendererContext`

Reduce la salida de `createSession()` a lo mínimo que el browser necesita. **Usalo siempre** en vez de armar el objeto a mano: es lo que evita filtrar un campo server-side.

```
toRendererContext(output: CreateSessionOutput): SessionForRenderer
```

Copia `sessionId`, `clientToken`, `clientTokenExpiresAt`, `hostedUiOrigin`, `allowedOrigin`, `environment` y, si están, `flowConfig`, `email`, `phone` e `identitySubjectStatus`. Nada más.

Es decir: **no** copia `flowKind`, `requiredInputs`, `journeyId`, `journeyVersion`, `authenticationProfileId` ni `authenticationProfileVersion`, aunque `SessionForRenderer` los admita como opcionales. El handshake no los necesita —`flowKind` viaja igual dentro de `flowConfig`—, así que el flujo monta perfecto sin ellos. Si tu UI los necesita arriba del objeto, agregalos **sobre** el resultado, sin inventar defaults:

```
const session = {
  ...toRendererContext(created),
  journeyId: created.journeyId,
  requiredInputs: created.requiredInputs,
};
```

Lo que sigue prohibido es armar el objeto desde cero: ahí es donde se filtra un campo server-side.

### Webhooks

```
constructWebhookEvent(
  rawBody: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  options?: VerifyWebhookOptions,
): WebhookEventEnvelope
```

`verifyWebhook` es un alias con la misma firma.

```
interface VerifyWebhookOptions {
  now?: Date;
  toleranceSeconds?: number;   // 300 por defecto
}
```

Lanza si la firma no valida, si falta un header obligatorio o si el timestamp quedó fuera de la ventana. El `rawBody` tiene que ser el cuerpo sin parsear.

### Verificación de documentos firmados

```
verifySignedPdfArtifact(
  artifact: SignedDocumentArtifact,
  authority: SignedDocumentStatus,
  options?: VerifySignedPdfArtifactOptions,
): Promise<SignedPdfVerificationEvidence>
```

**Tres argumentos posicionales**, no un objeto. `artifact` es lo que te llegó por `onDocumentSigned`; `authority` es lo que devolvió `getSignedDocumentStatus()`. Si le pasás un solo objeto, falla en la primera línea con `invalid_signed_document_input`.

```
interface VerifySignedPdfArtifactOptions {
  cmsVerifier?: DetachedCmsVerifier;   // por defecto, OpenSslCmsVerifier
  now?: () => Date;
}
```

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTQgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTYuMyA1LjY5YS45NDIuOTQyIDAgMCAxLS4yOC0uN2MwLS4yOC4wOS0uNTIuMjgtLjcuMTktLjE4LjQyLS4yOC43LS4yOC4yOCAwIC41Mi4wOS43LjI4LjE4LjE5LjI4LjQyLjI4LjcgMCAuMjgtLjA5LjUyLS4yOC43YTEgMSAwIDAgMS0uNy4zYy0uMjggMC0uNTItLjExLS43LS4zek04IDcuOTljLS4wMi0uMjUtLjExLS40OC0uMzEtLjY5LS4yLS4xOS0uNDItLjMtLjY5LS4zMUg2Yy0uMjcuMDItLjQ4LjEzLS42OS4zMS0uMi4yLS4zLjQ0LS4zMS42OWgxdjNjLjAyLjI3LjExLjUuMzEuNjkuMi4yLjQyLjMxLjY5LjMxaDFjLjI3IDAgLjQ4LS4xMS42OS0uMzEuMi0uMTkuMy0uNDIuMzEtLjY5SDhWNy45OHYuMDF6TTcgMi4zYy0zLjE0IDAtNS43IDIuNTQtNS43IDUuNjggMCAzLjE0IDIuNTYgNS43IDUuNyA1LjdzNS43LTIuNTUgNS43LTUuN2MwLTMuMTUtMi41Ni01LjY5LTUuNy01LjY5di4wMXpNNyAuOThjMy44NiAwIDcgMy4xNCA3IDdzLTMuMTQgNy03IDctNy0zLjEyLTctNyAzLjE0LTcgNy03eiIgLz48L3N2Zz4=)</span>No confundir con `SignedPdfVerificationInput`

Existe un tipo `SignedPdfVerificationInput { artifact, authority }`, pero **no** es el parámetro de esta función. Es el input de la capa interna de verificación.

Valida un PDF firmado contra su firma CMS separada. `OpenSslCmsVerifier` es la implementación provista de `DetachedCmsVerifier` —requiere `openssl` en el entorno del backend— y podés inyectar la tuya. Los fallos llegan como `SignedDocumentVerificationError` con un `SignedDocumentVerificationErrorCode`.

Uso completo:

```
import {
  verifySignedPdfArtifact,
  OpenSslCmsVerifier,
  SignedDocumentVerificationError,
} from "@lakaut/server";

const cmsVerifier = new OpenSslCmsVerifier();

const authority = await sessions.getSignedDocumentStatus(sessionId, documentId);

try {
  const evidence = await verifySignedPdfArtifact(artifact, authority, { cmsVerifier });
  await guardarConEvidencia(artifact.bytes, evidence);
} catch (error) {
  if (error instanceof SignedDocumentVerificationError) {
    // error.code trae el motivo exacto; no guardes el artefacto como probatorio
  }
  throw error;
}
```

### Validación de configuración

```
validateServerConfig(input: ServerSdkConfig): ServerSdkConfig
validateCreateSessionInput(input: CreateSessionInput): CreateSessionInput
assertBrowserSafeSessionOutput(output: CreateSessionOutput): CreateSessionOutput
```

Las tres **devuelven un valor**, no solo validan — usá siempre el retorno, no el input original:

- `validateServerConfig` devuelve una copia normalizada de la config.
- `validateCreateSessionInput` resuelve `flowType`/`journeyId`/`authenticationProfileId` a partir de lo que mandaste (podés pasar solo uno de los tres) y normaliza `identitySubject`. Si descartás el retorno y seguís usando tu `input` original, perdés esa resolución.
- `assertBrowserSafeSessionOutput` falla si el objeto que estás por mandarle al browser contiene algo que no debería salir del backend. Vale la pena llamarlo en tu endpoint, usando lo que devuelve como la respuesta real hacia el browser.

------------------------------------------------------------------------

## `@lakaut/browser`

Corre en el navegador. Nunca recibe la API key.

### `HostedUiRenderer`

```
new HostedUiRenderer(options: HostedUiRendererOptions)
```

```
interface HostedUiRendererOptions {
  session: SessionForRenderer;                  // lo que devolvió toRendererContext
  container: HTMLElement;
  on?: (event: BrowserLifecycleEvent) => void;
  language?: string;
  document?: HostedUiDocument;                  // para flujos de firma
  onDocumentSigned?: (artifact: SignedDocumentArtifact) => void | Promise<void>;
  debugHostedUi?: boolean;
}
```

| Método | Qué hace |
|----|----|
| `mount()` | Crea el iframe y arranca el handshake. Devuelve el `HTMLIFrameElement` |
| `destroy()` | Desmonta, corta listeners y libera el iframe |

Llamá a `destroy()` al desmontar tu componente. Si no, los listeners de `message` sobreviven a la navegación.

#### `SessionForRenderer`

```
interface SessionForRenderer {
  sessionId: string;
  clientToken: string;
  hostedUiOrigin: string;
  allowedOrigin: string;
  environment: LakautEnvironment;
  clientTokenExpiresAt?: string;
  flowConfig?: FlowConfig;
  flowKind?: FlowKind;
  requiredInputs?: readonly AuthenticationInput[];
  email?: string;
  phone?: string;
  identitySubjectStatus?: IdentitySubjectStatus;
}
```

### Eventos

El callback `on` recibe un `BrowserLifecycleEvent`:

| `event.type` | Cuándo |
|----|----|
| `lakaut.flow.ready` | La Hosted UI terminó de inicializar |
| `lakaut.flow.started` | Arrancó la experiencia |
| `lakaut.flow.step_started` | Empezó un paso |
| `lakaut.flow.step_progress` | Cambió el estado del paso |
| `lakaut.flow.step_completed` | Terminó un paso |
| `lakaut.flow.completed` | Terminó la experiencia visual |
| `lakaut.flow.cancelled` | Cancelada por el titular o el backend |
| `lakaut.flow.failed` | Error; trae `errorCode`, `safeMessage?` y `retryable` |
| `lakaut.flow.expired` | Venció la sesión |
| `lakaut.flow.closed` | Se pidió cerrar la experiencia |

`lakaut.flow.completed` significa que la **pantalla** terminó, no que la operación esté confirmada. La verdad está en tu backend.

### Utilidades de seguridad

```
FORBIDDEN_BROWSER_INPUT_KEYS          // claves que nunca deben llegar al browser
assertExactTargetOrigin(targetOrigin: string): void         // rechaza comodines y orígenes laxos
createOriginPolicy(input: OriginPolicy): OriginPolicy        // valida hostedUiOrigin y allowedParentOrigin juntos
validateIncomingOrigin(eventOrigin: string, expectedOrigin: string): void
validateHostedUiMessage(input: {
  message: unknown;
  eventOrigin: string;
  expectedHostedUiOrigin: string;
}): HostedUiMessageEnvelope                                  // valida origen y forma de un mensaje entrante
createBrowserError(input: {
  publicCode: PublicErrorCode;
  safeMessage: string;
  retryable?: boolean;
  httpStatus?: number;
  correlationId?: string;
}): PublicErrorEnvelope               // construye el error tipado que exponen los eventos del renderer
redactClientToken(value)              // para loguear sin filtrar la credencial
```

`validateIncomingOrigin` recibe dos strings — el origen del evento y el origen esperado — no un objeto de política. Para validar `hostedUiOrigin` y `allowedParentOrigin` juntos como una unidad, usá `createOriginPolicy`.

### Superficie de bajo nivel

`initialize`, `BrowserSdkClient`, `HostedUiLifecycle`, `mapHostedUiEvent`, `initOrchestration`, `reduce` y `resolveUnknownStep` existen para casos avanzados y para los tests del propio SDK. Una integración normal no los necesita: `HostedUiRenderer` alcanza.

------------------------------------------------------------------------

## `@lakaut/shared-contracts`

Tipos compartidos. Llega de forma transitiva; instalalo explícito solo si los importás.

Los más útiles: `SdkFlowType`, `FlowConfig`, `FlowStep`, `FlowStepType`, `BrowserLifecycleEvent`, `SignedDocumentArtifact`, `HostedUiDocument`, `WebhookEventEnvelope`, `LakautSdkErrorCode`, `AuthoritativeSessionStatus`.

También exporta el catálogo de errores: `categoryFor(code)` devuelve `"retry-in-step" | "terminal" | "session-recovery"`. Ver [Errores y recuperación](/documentacion-docusaurus-preprod/docs/sdk-integracion/errores).

### `LakautSdkErrorCode` vs `SdkPublicErrorCode`

Son **dos tipos distintos**, los dos reexportados desde `@lakaut/browser`. Casi siempre querés el primero:

| Tipo | Valores | Qué es |
|----|---:|----|
| `LakautSdkErrorCode` | 34 | El tipo de `event.errorCode` en `lakaut.flow.failed`. **Es el que vas a usar.** Es el que documenta [Errores y recuperación](/documentacion-docusaurus-preprod/docs/sdk-integracion/errores) y el que acepta `categoryFor()` |
| `SdkPublicErrorCode` | 19 | Subconjunto interno que usa el SDK para validar los mensajes entrantes de la Hosted UI. No cubre todos los códigos que puede traer un evento |

Si tipás tu manejo de errores con `SdkPublicErrorCode` te vas a quedar corto: 17 de los 34 códigos no están ahí. En sentido inverso, `document_sign_failed` y `signed_document_recovery_required` existen en `SdkPublicErrorCode` pero no llegan como `errorCode` de un evento de ciclo de vida.
