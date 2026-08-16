<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/frontend-hosted-ui -->

# Frontend y Hosted UI

El frontend obtiene un contexto efímero desde su propio backend y lo entrega a `HostedUiRenderer`.

## Contenedor HTML

```
<div id="lakaut-hosted-ui"></div>
```

No crees el iframe manualmente. El renderer configura:

- URL de Hosted UI;
- handshake;
- origen esperado;
- permisos de cámara y micrófono;
- sandbox;
- política de referrer;
- validación de mensajes.

## Montar el flujo

```
import { HostedUiRenderer } from "@lakaut/browser";

const response = await fetch("/api/lakaut/sessions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ flowType: "ONBOARDING" }),
});

if (!response.ok) throw new Error("No se pudo crear la sesión");

const { session } = await response.json();
const container = document.querySelector("#lakaut-hosted-ui");

const renderer = new HostedUiRenderer({
  session,
  container,
  language: "es",
  on(event) {
    renderProgress(event);
  },
});

renderer.mount();
```

## Desmontar correctamente

Cuando el usuario abandona la página:

```
renderer.destroy();
```

Esto elimina el iframe, listeners, timeouts y material efímero mantenido en memoria.

## Tamaño y responsive

El renderer monta un iframe de ancho completo y **altura fija: 810px, con un mínimo de 680px**. No es un porcentaje del contenedor ni se ajusta al contenido. El contenedor del integrador debe permitir al menos esa altura:

```
#lakaut-hosted-ui {
  width: 100%;
  min-width: 0;
  min-height: 680px;
  overflow: hidden;
}
```

Si el contenedor termina con menos altura que el iframe (por ejemplo, por un `min-height` más bajo o un layout que lo comprime), el `overflow: hidden` de arriba lo recorta en vez de mostrar scroll — asegurate de que el contenedor real tenga los 680-810px disponibles antes de montar. Evitá además transformaciones CSS u `overflow: hidden` en ancestros que puedan cortar Veriff. En dispositivos móviles, asegurate de que el viewport sea:

```
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

## Cámara y micrófono

La aplicación debe ejecutarse sobre HTTPS. Si Hosted UI está dentro de otro iframe, cada nivel debe delegar permisos:

```
<iframe allow="camera; microphone"></iframe>
```

También revisá `Permissions-Policy`, CSP y bloqueos del navegador.

## Qué puede recibir el browser

El contexto para el renderer puede incluir:

```
sessionId
clientToken
hostedUiOrigin
allowedOrigin
environment
flowConfig
email
identitySubjectStatus
```

No debe incluir:

```
apiKey
webhookSigningSecret
refreshToken
OTP
DNI
sexo
PIN o contraseña del certificado
clave privada
```

## El token efímero

`clientToken`:

- se mantiene únicamente en memoria;
- no se coloca en URLs;
- no se guarda en `localStorage`, `sessionStorage` ni cookies;
- no se envía a analytics;
- no se incluye en logs ni reportes de error.

## No usar `postMessage` directamente

`HostedUiRenderer` valida origen, ventana, namespace, sesión y handshake. No agregues listeners paralelos para interpretar mensajes internos de Hosted UI. Usá el callback `on` y `onDocumentSigned`.
