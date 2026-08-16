<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/backend-sesiones -->

# Backend y sesiones

Toda sesión comienza en el backend del integrador. Este límite evita que la API key privada llegue al navegador.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTQgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTcgMi4zYzMuMTQgMCA1LjcgMi41NiA1LjcgNS43cy0yLjU2IDUuNy01LjcgNS43QTUuNzEgNS43MSAwIDAgMSAxLjMgOGMwLTMuMTQgMi41Ni01LjcgNS43LTUuN3pNNyAxQzMuMTQgMSAwIDQuMTQgMCA4czMuMTQgNyA3IDcgNy0zLjE0IDctNy0zLjE0LTctNy03em0xIDNINnY1aDJWNHptMCA2SDZ2Mmgydi0yeiIgLz48L3N2Zz4=)</span>De dónde salen estas credenciales

`LAKAUT_INTEGRATOR_ID` es el slug de tu integración y `LAKAUT_API_KEY` la generás vos desde [Credenciales y accesos](/documentacion-docusaurus-preprod/docs/sdk-integracion/credenciales). Guardalas en tu gestor de secretos: no las inventes, no las reutilices entre ambientes y no las expongas al frontend.

## Configurar el cliente

```
import {
  HttpAuthTransport,
  SessionClient,
  toRendererContext,
} from "@lakaut/server";

const transport = new HttpAuthTransport({
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
});

const sessions = new SessionClient(transport);
```

Para preproducción:

```
LAKAUT_AUTH_BASE_URL=https://auth-preprod.lakautac.com.ar
LAKAUT_INTEGRATOR_ID=el-slug-de-tu-integracion
LAKAUT_API_KEY=el-valor-que-copiaste-del-dashboard
```

Los metadatos de compatibilidad deben coincidir con la versión que instalaste. No copies valores de otro ambiente.

Para rotar o revocar la API key entrá a **Integradores → Mi integración**; no hace falta abrir un ticket. Tené en cuenta que rotar invalida la credencial anterior de inmediato: actualizá el secreto de tu backend en el mismo momento.

## Crear un endpoint propio

Tu frontend debe hablar con **tu backend**, no directamente con Auth:

```
app.post("/api/lakaut/sessions", requireAuthenticatedUser, async (req, res) => {
  const created = await sessions.createSession({
    flowType: req.body.flowType,
    allowedOrigin: process.env.APP_PUBLIC_ORIGIN,
    email: req.user.email,
    externalUserRef: req.user.applicationId,
  });

  res.status(201).json({
    session: toRendererContext(created),
    correlationId: created.correlationId,
  });
});
```

Protegé este endpoint con la autenticación de tu aplicación. Asociá cada `sessionId` con el usuario y la operación que lo originaron.

## Campos de creación

| Campo | Requerido | Descripción |
|----|---:|----|
| `allowedOrigin` | Sí | Origen exacto que montará Hosted UI — es el único campo estrictamente obligatorio |
| `flowType` | Uno de los dos\* | Uno de los cuatro flujos soportados |
| `journeyId` | Uno de los dos\* | Alternativa a `flowType`: identifica el recorrido comercial directamente |
| `authenticationProfileId` | No | Fuerza un método de autenticación puntual dentro del recorrido resuelto |
| `externalUserRef` | No | Referencia no sensible de tu negocio |
| `email` | No — salvo con `auth.sms.v1` | Email inicial; Hosted UI lo utiliza sin exponerlo en eventos |
| `phone` | No — salvo con `auth.sms.v1` | Prellenado de conveniencia, igual que `email` |
| `identitySubject` | No | DNI y sexo registral, solo para onboarding |
| `returnUrl` | No | URL absoluta de retorno |
| `cancelUrl` | No | URL absoluta de cancelación |
| `continuationFromSessionId` | No | Continuación segura hacia una sesión `SIGNING` u `ONBOARDING_AND_SIGNING` |

\* Mandá `flowType` o `journeyId` (al menos uno) — el SDK resuelve el recorrido a partir de cualquiera de los dos.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTIgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTUuMDUuMzFjLjgxIDIuMTcuNDEgMy4zOC0uNTIgNC4zMUMzLjU1IDUuNjcgMS45OCA2LjQ1LjkgNy45OGMtMS40NSAyLjA1LTEuNyA2LjUzIDMuNTMgNy43LTIuMi0xLjE2LTIuNjctNC41Mi0uMy02LjYxLS42MSAyLjAzLjUzIDMuMzMgMS45NCAyLjg2IDEuMzktLjQ3IDIuMy41MyAyLjI3IDEuNjctLjAyLjc4LS4zMSAxLjQ0LTEuMTMgMS44MSAzLjQyLS41OSA0Ljc4LTMuNDIgNC43OC01LjU2IDAtMi44NC0yLjUzLTMuMjItMS4yNS01LjYxLTEuNTIuMTMtMi4wMyAxLjEzLTEuODkgMi43NS4wOSAxLjA4LTEuMDIgMS44LTEuODYgMS4zMy0uNjctLjQxLS42Ni0xLjE5LS4wNi0xLjc4QzguMTggNS4zMSA4LjY4IDIuNDUgNS4wNS4zMkw1LjAzLjNsLjAyLjAxeiIgLz48L3N2Zz4=)</span>Con `auth.sms.v1`, `email` y `phone` son obligatorios

Aunque el OTP viaje por SMS, ese perfil es *server-bound*: exige **los dos** datos. Si falta cualquiera de ellos, `createSession()` falla antes de salir de tu proceso con `"SMS-only authentication requires server-bound email and phone"`, y el backend de Lakaut responde `400 INVALID_REQUEST`. Los otros dos perfiles (`auth.email-sms.v1`, `auth.email.v1`) no imponen esta condición a nivel SDK.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>Tres campos del tipo que no viajan

`CreateSessionInput` todavía declara `clientContext`, `idempotencyKey` y `requestedTtlSeconds`, pero el transporte HTTP **no los serializa** y el backend tampoco los conoce. Compilan, se validan y se descartan.

En concreto: no confíes en `idempotencyKey` para evitar sesiones duplicadas —no hace nada— y no esperes que `clientContext` vuelva en los eventos. Si necesitás idempotencia, resolvela en tu endpoint antes de llamar a `createSession()`. Para correlacionar, usá `externalUserRef` (que sí viaja) y el `correlationId` que devuelve Lakaut.

### Qué recorrido y qué perfil puedo usar

No hardcodees la matriz: `sessions.getCatalog()` devuelve exactamente lo que tu integración tiene habilitado — los journeys, los perfiles de autenticación y las `allowedCombinations` válidas entre ambos.

```
const catalog = await sessions.getCatalog();
// catalog.journeys[]                → { id, version, displayName, flowKind, legacyFlowType, defaultAuthenticationProfileId }
// catalog.authenticationProfiles[]  → { id, version, displayName, factors, requiredInputs, requiresServerBoundIdentity }
// catalog.allowedCombinations[]     → { journeyId, journeyVersion, authenticationProfileId, authenticationProfileVersion }
```

Un detalle que cambia el resultado: si omitís `authenticationProfileId`, el default depende de **cómo** elegiste el recorrido. Con `journeyId` se usa el default de ese journey; con `flowType` se usa siempre `auth.email-sms.v1`, aunque además mandes el `journeyId`. Hoy la diferencia solo se nota en firma —`journey.signing.v1` tiene como default `auth.email.v1`, así que `{ flowType: "SIGNING" }` termina pidiendo también SMS y `{ journeyId: "journey.signing.v1" }` no—. Si el método de autenticación te importa, mandá `authenticationProfileId` explícito.

Los ejemplos de esta guía usan `allowedOrigin` fijo por variable de entorno porque asumen una app de un solo origen — ahí es correcto, no hay ningún header de cliente en juego. Si tu app sirve varios subdominios con una sola integración (multi-tenant), resolvé `allowedOrigin` por request contra tu propia lista en vez de una constante — ver ["El comodín no aplica a la sesión"](/documentacion-docusaurus-preprod/docs/sdk-integracion/credenciales#el-comod%C3%ADn-no-aplica-a-la-sesi%C3%B3n) para el patrón completo.

## Enviar DNI y sexo desde el backend

Si tu sistema ya posee ambos datos desde una fuente confiable:

```
const created = await sessions.createSession({
  flowType: "ONBOARDING",
  allowedOrigin: process.env.APP_PUBLIC_ORIGIN,
  email: applicant.email,
  identitySubject: {
    dni: applicant.dni,
    sexo: applicant.registeredSex,
  },
});
```

Reglas:

- `dni`: 7 u 8 dígitos;
- `sexo`: `M` o `F`;
- solo se acepta en `ONBOARDING` y `ONBOARDING_AND_SIGNING`;
- el valor permanece server-side;
- el frontend recibe únicamente `identitySubjectStatus: "provided"`.

Si falta cualquiera de los dos campos, omití `identitySubject`. Hosted UI pedirá ambos y el frontend recibirá `identitySubjectStatus: "required"`.

## Onboarding y firma como sesiones independientes

Cuando el onboarding terminó y luego querés iniciar una firma sin repetir OTP:

```
const signing = await sessions.createSession({
  flowType: "SIGNING",
  allowedOrigin: process.env.APP_PUBLIC_ORIGIN,
  continuationFromSessionId: completedOnboardingSessionId,
});
```

La continuación:

- es de un solo uso;
- tiene una vigencia corta;
- se acepta para `SIGNING` y `ONBOARDING_AND_SIGNING` (cualquier flujo con capacidad de firma), no solo `SIGNING`;
- nunca se envía como campo separado al navegador.

Una sesión sin continuación realiza su propia autenticación por OTP.

## Consultar y cerrar la sesión

```
const current = await sessions.getSession(sessionId);

if (allBusinessStepsSucceeded) {
  await sessions.completeSession(sessionId);
}

if (userCancelled) {
  await sessions.cancelSession(sessionId);
}
```

La sesión permanece activa hasta que el backend la completa o cancela explícitamente. En firma, esto permite procesar más de un documento antes de cerrarla.

No llames `completeSession` hasta:

1.  recibir las copias y aplicar la validación server-side requerida;
2.  consultar las constancias autoritativas necesarias;
3.  terminar los efectos de negocio asociados.

## Estado autoritativo

Los estados posibles son:

```
created
in_progress
started
completed
cancelled
failed
expired
```

Son los siete valores del tipo `SdkSessionStatus`, **en minúscula**: el SDK normaliza el `status` que Auth devuelve en MAYÚSCULA. Si consumís el endpoint HTTP directamente vas a ver `CREATED`, `IN_PROGRESS`, `COMPLETED`, `CANCELLED`, `FAILED` y `EXPIRED` —seis, sin `started`—. Ese séptimo valor existe en el tipo del SDK pero el backend no lo emite hoy; tratalo como no-terminal, igual que `in_progress`.

Terminales: `completed`, `cancelled`, `failed` y `expired`.

Los eventos del navegador son informativos. Para decidir el estado final usá `getSession`, `getSignedDocumentStatus` o los webhooks firmados.
