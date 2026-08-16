<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/configurar-webhook -->

# Configurar y rotar el webhook

El webhook se administra por ambiente desde **Integradores → Mi integración**. La URL y el secreto no los configura soporte: los genera y valida el propio integrador desde el dashboard.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTIgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTUuMDUuMzFjLjgxIDIuMTcuNDEgMy4zOC0uNTIgNC4zMUMzLjU1IDUuNjcgMS45OCA2LjQ1LjkgNy45OGMtMS40NSAyLjA1LTEuNyA2LjUzIDMuNTMgNy43LTIuMi0xLjE2LTIuNjctNC41Mi0uMy02LjYxLS42MSAyLjAzLjUzIDMuMzMgMS45NCAyLjg2IDEuMzktLjQ3IDIuMy41MyAyLjI3IDEuNjctLjAyLjc4LS4zMSAxLjQ0LTEuMTMgMS44MSAzLjQyLS41OSA0Ljc4LTMuNDIgNC43OC01LjU2IDAtMi44NC0yLjUzLTMuMjItMS4yNS01LjYxLTEuNTIuMTMtMi4wMyAxLjEzLTEuODkgMi43NS4wOSAxLjA4LTEuMDIgMS44LTEuODYgMS4zMy0uNjctLjQxLS42Ni0xLjE5LS4wNi0xLjc4QzguMTggNS4zMSA4LjY4IDIuNDUgNS4wNS4zMkw1LjAzLjNsLjAyLjAxeiIgLz48L3N2Zz4=)</span>El secreto vive solo en tu backend

No lo incluyas en el browser, repositorios, tickets ni logs. Copialo directamente desde el diálogo **Guardá esta credencial ahora** a tu gestor de secretos.

## Requisitos del endpoint

El destino tiene que:

- usar `https://` y el puerto estándar `443`;
- resolver únicamente a direcciones IP públicas globalmente enrutables;
- no incluir usuario, contraseña ni fragmento en la URL;
- aceptar `POST` sin redirecciones;
- responder en menos de 5 segundos.

Lakaut vuelve a validar el destino al conectarse. Direcciones privadas, loopback, link-local, CGNAT, rangos reservados y cambios de DNS hacia esas redes se rechazan.

## Alta inicial

1.  Guardá la URL en **Conexión con Lakaut**. Queda en estado **Pendiente de verificación**.
2.  Elegí **Generar secreto**.
3.  Copiá el valor que muestra el diálogo. Se entrega una sola vez.
4.  Instalalo como `LAKAUT_WEBHOOK_SECRET` en el backend que atiende esa URL.
5.  Implementá el challenge descripto abajo y desplegalo.
6.  Elegí **Verificar destino**. Lakaut hace una prueba HTTP firmada.
7.  Esperá el estado **Verificado** antes de depender de las entregas.

Cerrar el diálogo sin copiar no permite recuperar el valor. Generá uno nuevo desde el dashboard; no solicites que soporte te revele el anterior.

| Estado | Significado |
|----|----|
| No configurado | No hay destino y Lakaut no intenta entregar eventos |
| Pendiente de verificación | La URL o el secreto nuevo todavía no están activos |
| Verificado | El par URL/secreto está activo para firmar y entregar eventos |
| Rechazado | El challenge falló; corregí el endpoint y volvé a verificar |

## Responder el challenge

Lakaut envía un `POST` al destino pendiente:

```
{
  "schemaVersion": 1,
  "type": "lakaut.webhook.challenge",
  "challengeId": "5ae245d3-7eb4-4d4a-b71f-dde5b417dc34",
  "nonce": "BASE64URL_ALEATORIO",
  "issuedAt": "2026-08-13T15:00:00Z",
  "expiresAt": "2026-08-13T15:05:00Z"
}
```

Headers relevantes:

```
Lakaut-Webhook-Id: <challengeId>
Lakaut-Webhook-Timestamp: <issuedAt>
Lakaut-Webhook-Signature: v1=<hex>
```

Primero verificá en tiempo constante:

```
HMAC-SHA256(secreto, `${Lakaut-Webhook-Timestamp}.${rawBody}`)
```

Luego respondé `2xx`, con un JSON de no más de 4096 bytes:

```
{
  "challengeId": "5ae245d3-7eb4-4d4a-b71f-dde5b417dc34",
  "nonce": "BASE64URL_ALEATORIO",
  "proof": "v1=<hex>"
}
```

El `proof` es:

```
HMAC-SHA256(secreto, `${challengeId}.${nonce}`)
```

Ejemplo mínimo con Express:

```
import crypto from "node:crypto";
import express from "express";

const secret = process.env.LAKAUT_WEBHOOK_SECRET;
if (!secret) throw new Error("Falta LAKAUT_WEBHOOK_SECRET");

const app = express();

app.post("/webhooks/lakaut", express.raw({ type: "application/json", limit: "64kb" }), (req, res, next) => {
  const rawBody = req.body;
  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).send("invalid json");
  }

  if (payload.type !== "lakaut.webhook.challenge") return next();

  const id = req.get("Lakaut-Webhook-Id");
  const timestamp = req.get("Lakaut-Webhook-Timestamp");
  const received = req.get("Lakaut-Webhook-Signature") ?? "";
  if (id !== payload.challengeId || timestamp !== payload.issuedAt) {
    return res.status(400).send("invalid challenge");
  }

  const expected = `v1=${crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;

  const valid = received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!valid || Date.parse(payload.expiresAt) < Date.now()) {
    return res.status(401).send("invalid challenge");
  }

  const proof = `v1=${crypto
    .createHmac("sha256", secret)
    .update(`${payload.challengeId}.${payload.nonce}`)
    .digest("hex")}`;

  return res.status(200).json({
    challengeId: payload.challengeId,
    nonce: payload.nonce,
    proof,
  });
});
```

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>El challenge no es un evento de negocio

Usa headers y material de firma distintos. No lo pases a `constructWebhookEvent()`: esa función verifica eventos `auth.*` y `otp.*`, explicados en [Eventos, webhooks y estado](/documentacion-docusaurus-preprod/docs/sdk-integracion/eventos-estado).

## Cambiar URL o rotar el secreto

Elegí **Rotar secreto** para reemplazarlo, o guardá una URL distinta para cambiar el destino. Lakaut prepara un par pendiente y vuelve a mostrar el secreto una sola vez. El destino verificado anterior continúa activo hasta que el challenge nuevo termina bien; un challenge fallido no lo reemplaza.

Después de verificar, el cambio de URL y secreto se activa en conjunto. No hay un período de convivencia entre secretos: desde ese momento verificá con el nuevo. Los reintentos pendientes también se firman y envían al destino vigente.

Para minimizar una interrupción:

1.  generá el secreto pendiente;
2.  instalalo en el nuevo destino;
3.  mantené temporalmente ambos secretos en tu verificador;
4.  ejecutá **Verificar destino**;
5.  confirmá una entrega real con el secreto nuevo;
6.  retirale al anterior el acceso a tu backend.

## Deshabilitar

Borrá la URL y guardá. La siguiente revisión proyecta la ausencia del destino y Lakaut deja de resolverlo. No existe fallback a una variable administrada manualmente por soporte.

## Custodia y ambientes

Lakaut necesita el secreto vigente para firmar eventos. Por eso conserva una copia cifrada para operación, separada de la entrega de una sola lectura del dashboard. El secreto no aparece en consultas, auditoría ni logs, y cada servicio lo cifra nuevamente en su propia custodia.

Cada ambiente tiene URL y secreto independientes. No copies el secreto de preproducción a producción.

## Si la verificación falla

- Confirmá que el secreto instalado sea exactamente el último generado.
- Verificá el HMAC sobre los bytes crudos del body, sin parsear y serializar nuevamente.
- Asegurate de responder el mismo `challengeId` y `nonce`, más el `proof` firmado.
- Revisá certificado TLS, DNS público, puerto, redirects y tiempos de respuesta.
- Si perdiste el secreto pendiente, rotalo; no puede recuperarse.
