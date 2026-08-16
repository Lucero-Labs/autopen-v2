<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/arquitectura -->

# Arquitectura de integración

La API key del integrador vive exclusivamente en su backend. El frontend recibe un `clientToken` efímero, acotado a una sesión y a un origen.

## Límites de responsabilidad

### Backend del integrador

- autentica a su propio usuario;
- conserva `integratorId`, API key y, si se habilitó por separado, secreto de webhook;
- obtiene DNI y sexo desde una fuente confiable, si dispone de ellos;
- crea, consulta, completa y cancela sesiones;
- entrega el contexto seguro al frontend correspondiente;
- recibe la copia del PDF y aplica la validación server-side requerida por su caso;
- deduplica webhooks y confirma el estado final.

### Frontend del integrador

- solicita una sesión a su propio backend;
- monta `HostedUiRenderer`;
- opcionalmente entrega un PDF en memoria;
- recibe eventos de progreso;
- entrega el PDF firmado a su backend mediante `onDocumentSigned`;
- destruye el renderer cuando abandona la vista.

### Lakaut

- muestra las pantallas sensibles;
- gestiona OTP, Veriff, RENAPER, certificado y firma;
- valida origen, sesión y handshake;
- nunca entrega la API key al navegador;
- mantiene el estado autoritativo y emite webhooks.

## Tres canales diferentes

| Canal | Uso | Es verdad final |
|----|----|----|
| Eventos de `HostedUiRenderer` | Actualizar la experiencia del usuario | No |
| `onDocumentSigned` | Entregar los bytes del PDF firmado | No por sí solo |
| Estado backend/webhook | Confirmar sesión y constancia de firma | Sí |

No completes operaciones irreversibles únicamente porque el frontend recibió `lakaut.flow.completed`.

## Orígenes exactos

`allowedOrigin` debe ser un origen exacto:

```
https://app.integrador.example
```

No debe incluir path, query, fragmento ni wildcard:

```
https://app.integrador.example/firma   ❌
https://*.integrador.example           ❌
*                                      ❌
```

Esto es el origen **de la sesión**, y es distinto de los dominios que declarás en el dashboard: ahí sí se admite un comodín de un nivel. La declaración define qué dominios están habilitados; el `allowedOrigin` dice desde cuál se abre esta sesión en particular, y tiene que ser concreto porque el `postMessage` del navegador exige un destino exacto. Ver [Credenciales y configuración](/documentacion-docusaurus-preprod/docs/sdk-integracion/credenciales).

Cada ambiente y subdominio requiere su propia configuración.
