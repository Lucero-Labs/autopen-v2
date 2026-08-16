<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/seguridad -->

# Seguridad

## Checklist obligatorio

- API key únicamente en backend.
- Credenciales de Nexus únicamente en gestores de secretos de desarrollo y CI.
- Rotaciones y revocaciones de API key y credencial de Nexus hechas por vos mismo desde el dashboard, no vía ticket.
- `clientToken` solo en memoria.
- `allowedOrigin` de cada sesión: HTTPS exacto, sin wildcard.
- Dominios declarados: comodín solo si tu app crea subdominios sola, y acotado a una rama que controles entera.
- Sesiones asociadas al usuario autenticado del integrador.
- Endpoints propios protegidos contra acceso anónimo y CSRF.
- Secreto de webhook únicamente en backend y gestor de secretos.
- Challenge de webhook verificado antes de habilitar entregas.
- Eventos de webhook verificados sobre el body crudo y deduplicados.
- PDFs guardados en almacenamiento autorizado.
- Logs sin datos personales ni credenciales.
- Dependencias fijadas con lockfile.

## Frontera backend/browser

El backend puede manejar:

```
integratorId
apiKey
webhookSigningSecret
identitySubject
clientToken durante la creación de sesión
```

El browser solo puede recibir el contexto generado por `toRendererContext`: `sessionId`, `clientToken`, `clientTokenExpiresAt`, `hostedUiOrigin`, `allowedOrigin`, `environment` y, si están, `flowConfig`, `email`, `phone` e `identitySubjectStatus`.

No construyas manualmente un objeto parecido ni copies la respuesta completa de Auth. Si necesitás algún campo extra que `toRendererContext` no copia —`journeyId`, `requiredInputs`, `flowKind`—, agregalo **sobre** el resultado, nunca reconstruyendo el objeto desde cero.

## Gestión de credenciales

Lakaut asigna `integratorId` una única vez, al dar de alta la integración. A partir de ahí, emitir, rotar y revocar tanto la API key de Auth como la credencial de Nexus son operaciones de autoservicio desde **Integradores → Mi integración** (ver [Credenciales y accesos](/documentacion-docusaurus-preprod/docs/sdk-integracion/credenciales)) — no requieren pedirle nada a Lakaut. Los secretos de webhook se generan, rotan y verifican desde el mismo dashboard (ver [Configurar y rotar el webhook](/documentacion-docusaurus-preprod/docs/sdk-integracion/configurar-webhook)). El integrador:

- almacena los valores entregados en un gestor de secretos;
- limita el acceso a los procesos que realmente los necesitan;
- rota la credencial ante exposición o cambio de responsables, desde el dashboard;
- elimina las copias anteriores después de confirmar la rotación;
- no comparte credenciales entre ambientes o proveedores.

El usuario de Nexus es de solo lectura y no reemplaza a la API key de Auth.

La API key y Nexus se validan con hashes. El webhook es distinto: Lakaut necesita el secreto vigente para firmar, por lo que mantiene custodia cifrada separada de la copia efímera que muestra una sola vez. No se expone en consultas, auditoría ni logs.

## Origen y framing

La sesión queda vinculada a `allowedOrigin`. El SDK valida:

- origen exacto de Hosted UI;
- origen exacto del parent;
- ventana que envió el mensaje;
- `sessionId`;
- `handshakeId`;
- esquema del payload.

Hosted UI usa iframe sandboxed y política `no-referrer`.

## Content Security Policy

`hostedUiOrigin` viaja en cada sesión, pero no cambia de una sesión a otra: es un valor fijo por ambiente, que sale de la configuración del servicio de Hosted UI, no algo que el integrador elija ni que varíe según el usuario o el flujo. Por eso tu CSP puede ser estática — no necesitás leerla de la respuesta de cada sesión ni actualizarla en runtime:

```
frame-src 'self' https://sdk-preprod.lakautac.com.ar;
```

Si tu CSP usa `child-src`, mantenelo alineado. No abras `frame-src *`.

Para Veriff, Lakaut configura sus propios orígenes dentro de Hosted UI. El integrador no debe hardcodear tokens ni URLs de sesión del proveedor.

## Permissions Policy

No bloquees cámara o micrófono para Hosted UI:

```
Permissions-Policy: camera=(self "https://sdk-preprod.lakautac.com.ar"),
                    microphone=(self "https://sdk-preprod.lakautac.com.ar")
```

Adaptá el header al origen que Lakaut devuelva en la sesión.

## Protección de endpoints propios

El endpoint que crea sesiones debe:

1.  autenticar al usuario;
2.  autorizar la operación;
3.  validar `flowType`;
4.  usar un `allowedOrigin` configurado server-side;
5.  vincular `sessionId` con usuario y operación;
6.  limitar tamaño y frecuencia;
7.  responder con `cache-control: no-store`.

No aceptes `allowedOrigin`, `integratorId`, API key o `identitySubject` arbitrarios desde un browser no confiable.

## Datos de identidad

Si proporcionás DNI y sexo:

- obtenelos de una fuente confiable del backend;
- no los copies al renderer;
- no los guardes en analytics;
- aplicá tus políticas de minimización, cifrado y retención.

Cuando Hosted UI los captura, se envían directamente a Lakaut y no se incluyen en los eventos públicos.

## PIN del certificado

El PIN:

- se ingresa dentro de Hosted UI;
- no se entrega al integrador;
- no debe persistirse;
- no debe registrarse;
- se borra al terminar cada intento.

## PDF firmado

`SignedDocumentArtifact` existe temporalmente en memoria del browser. Transferilo de inmediato a un endpoint autenticado de tu backend como una copia recibida desde un cliente no confiable y aplicá:

- control de acceso;
- cifrado en tránsito y reposo;
- validación de tamaño y tipo;
- idempotencia;
- trazabilidad;
- política de retención.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>Custodia autoritativa

Recibir `bytes` y `finalPdfHash` desde el mismo browser no demuestra por sí solo que esos bytes sean el artefacto firmado por Lakaut. Confirmá el estado mediante `getSignedDocumentStatus` o el webhook firmado.

Si tu caso requiere custodia probatoria del PDF exacto, la validación CMS server-side ya viene en `@lakaut/server`: `verifySignedPdfArtifact(artifact, authority, { cmsVerifier })` con `OpenSslCmsVerifier`. No hay que coordinar ningún mecanismo aparte. La receta completa —con los códigos de error y la evidencia que devuelve— está en [Documentos y firma](/documentacion-docusaurus-preprod/docs/sdk-integracion/documentos-firma#custodia-probatoria-verifysignedpdfartifact).

## Reportes y soporte

Compartí `sessionId`, `documentId`, `correlationId`, código y horario. Nunca envíes capturas que muestren OTP, DNI, PIN, documentos personales o credenciales.
