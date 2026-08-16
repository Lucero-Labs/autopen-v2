<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/errores -->

# Errores y recuperación

Hay dos superficies de error distintas y conviene no confundirlas:

- **Los eventos del browser** (`lakaut.flow.failed`) usan códigos públicos en minúscula. Son los que ve tu frontend.
- **Las respuestas HTTP de la API** usan códigos en MAYÚSCULA. Son los que ve tu backend.

Ninguna de las dos expone detalles internos. No muestres el texto crudo de un error de backend directamente al usuario.

## Lo único que hay que decidir

Ante cualquier error, la pregunta es siempre la misma: **¿el titular puede resolverlo reintentando?**

Lakaut clasifica cada código de la API en una de tres categorías. Esa clasificación vive en un catálogo compartido entre el servicio y el SDK, y es la que usa la Hosted UI para decidir sola qué hacer.

| Categoría | Qué significa | Qué hace la Hosted UI | Qué tenés que hacer vos |
|----|----|----|----|
| **retry-in-step** | Se resuelve reintentando dentro del paso activo | Deja al titular reintentar sin perder contexto | Nada. No recrees la sesión |
| **terminal** | El paso no puede continuar; reintentar no lo arregla | Termina el flujo con una salida explícita y emite `lakaut.flow.failed` | Mostrar una salida al usuario y, si corresponde, escalar |
| **session-recovery** | La sesión ya no sirve | Recupera la credencial o corta la sesión | Crear una sesión nueva |

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTIgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTYuNSAwQzMuNDggMCAxIDIuMTkgMSA1YzAgLjkyLjU1IDIuMjUgMSAzIDEuMzQgMi4yNSAxLjc4IDIuNzggMiA0djFoNXYtMWMuMjItMS4yMi42Ni0xLjc1IDItNCAuNDUtLjc1IDEtMi4wOCAxLTMgMC0yLjgxLTIuNDgtNS01LjUtNXptMy42NCA3LjQ4Yy0uMjUuNDQtLjQ3LjgtLjY3IDEuMTEtLjg2IDEuNDEtMS4yNSAyLjA2LTEuNDUgMy4yMy0uMDIuMDUtLjAyLjExLS4wMi4xN0g1YzAtLjA2IDAtLjEzLS4wMi0uMTctLjItMS4xNy0uNTktMS44My0xLjQ1LTMuMjMtLjItLjMxLS40Mi0uNjctLjY3LTEuMTFDMi40NCA2Ljc4IDIgNS42NSAyIDVjMC0yLjIgMi4wMi00IDQuNS00IDEuMjIgMCAyLjM2LjQyIDMuMjIgMS4xOUMxMC41NSAyLjk0IDExIDMuOTQgMTEgNWMwIC42Ni0uNDQgMS43OC0uODYgMi40OHpNNCAxNGg1Yy0uMjMgMS4xNC0xLjMgMi0yLjUgMnMtMi4yNy0uODYtMi41LTJ6IiAvPjwvc3ZnPg==)</span>El default es seguro

Un código que el SDK no conoce se trata como **retry-in-step**. Escalar un código desconocido obligaría a reanudar el flujo, y eso le haría repetir al titular pasos que ya completó —OTP, identidad, certificado—. Ante la duda, el SDK prefiere dejarlo en el paso.

## Códigos de la API

### retry-in-step

El titular sigue en el paso y puede volver a intentar. No recrees la sesión.

| Código | Cuándo aparece |
|----|----|
| `OTP_INVALID` | El código ingresado no es correcto |
| `OTP_EXPIRED` | El código venció; hay que pedir uno nuevo |
| `OTP_ATTEMPTS_EXCEEDED` | Se agotaron los intentos de ese código |
| `OTP_DELIVERY_UNAVAILABLE` | No se pudo enviar el código por el canal elegido |
| `RATE_LIMITED` | Demasiadas solicitudes; esperar antes de reintentar |
| `INVALID_REQUEST` | La solicitud no es válida en el estado actual |
| `SESSION_NOT_READY` | La sesión todavía no está lista para completarse |
| `IDENTITY_SUBJECT_REQUIRED` | Faltan DNI y sexo del titular |
| `IDENTITY_SUBJECT_INVALID` | DNI o sexo inválidos |
| `IDENTITY_PROVIDER_UNAVAILABLE` | El proveedor de identidad no responde |
| `IDENTITY_RESOLUTION_UNAVAILABLE` | No se pudo resolver la identidad en este momento |
| `CERTIFICATE_REQUIRED` | Hace falta un certificado válido para continuar |
| `CERTIFICATE_NOT_AVAILABLE` | Todavía no hay un certificado vigente |
| `CERTIFICATE_PIN_INVALID` | La clave del certificado no cumple los requisitos |
| `CERTIFICATE_PROVIDER_UNAVAILABLE` | El proveedor de certificados no responde |
| `SIGN_PIN_INVALID` | La clave de firma no es correcta |
| `SIGN_PIN_RATE_LIMITED` | Demasiados intentos de firma seguidos |
| `SIGN_HASH_INVALID` | El hash enviado no tiene el formato esperado |
| `SIGN_INVALID_REQUEST` | No se pudo firmar con los datos provistos |
| `SIGN_CERTIFICATE_REQUIRED` | Falta un certificado de persona física válido |
| `SIGN_PROVIDER_UNAVAILABLE` | El servicio de firma no responde |
| `SIGN_CERTIFICATE_PROVIDER_UNAVAILABLE` | No se pudo verificar el certificado |
| `WEBHOOK_DELIVERY_FAILED` | Falla de entrega server-to-server; no la ve el browser |

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTQgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTYuMyA1LjY5YS45NDIuOTQyIDAgMCAxLS4yOC0uN2MwLS4yOC4wOS0uNTIuMjgtLjcuMTktLjE4LjQyLS4yOC43LS4yOC4yOCAwIC41Mi4wOS43LjI4LjE4LjE5LjI4LjQyLjI4LjcgMCAuMjgtLjA5LjUyLS4yOC43YTEgMSAwIDAgMS0uNy4zYy0uMjggMC0uNTItLjExLS43LS4zek04IDcuOTljLS4wMi0uMjUtLjExLS40OC0uMzEtLjY5LS4yLS4xOS0uNDItLjMtLjY5LS4zMUg2Yy0uMjcuMDItLjQ4LjEzLS42OS4zMS0uMi4yLS4zLjQ0LS4zMS42OWgxdjNjLjAyLjI3LjExLjUuMzEuNjkuMi4yLjQyLjMxLjY5LjMxaDFjLjI3IDAgLjQ4LS4xMS42OS0uMzEuMi0uMTkuMy0uNDIuMzEtLjY5SDhWNy45OHYuMDF6TTcgMi4zYy0zLjE0IDAtNS43IDIuNTQtNS43IDUuNjggMCAzLjE0IDIuNTYgNS43IDUuNyA1LjdzNS43LTIuNTUgNS43LTUuN2MwLTMuMTUtMi41Ni01LjY5LTUuNy01LjY5di4wMXpNNyAuOThjMy44NiAwIDcgMy4xNCA3IDdzLTMuMTQgNy03IDctNy0zLjEyLTctNyAzLjE0LTcgNy03eiIgLz48L3N2Zz4=)</span>`CERTIFICATE_NOT_AVAILABLE`

Este código causó un incidente real: no figuraba en ninguna lista del cliente, cayó al camino genérico y destruyó un flujo de firma en curso. Hoy está catalogado como reintentable y la Hosted UI lo trata como tal. Si tu integración mantiene lógica propia de clasificación de errores, revisá que no lo esté escalando.

### terminal

Reintentar no cambia nada. La Hosted UI corta el flujo y emite `lakaut.flow.failed` con `retryable: false`.

| Código | Cuándo aparece |
|----|----|
| `UNAUTHORIZED` | Falta o no sirve la credencial del backend |
| `FORBIDDEN` | La operación no está permitida |
| `FORBIDDEN_ORIGIN` | El `Origin` no coincide con el vinculado a la sesión |
| `INTEGRATOR_DISABLED` | La integración está deshabilitada |
| `INTEGRATOR_ROUTED_TO_LEGACY` | La integración apunta al iframe legacy, no al SDK |
| `UNSUPPORTED_VERSION` | Versión de contrato no soportada |
| `FLOW_CONFIG_INVALID` | La sesión no admite ese flujo |
| `IDENTITY_SUBJECT_CONFLICT` | La identidad de la sesión no puede reemplazarse |
| `CERTIFICATE_IDENTITY_NOT_APPROVED` | La identidad debe estar aprobada antes de emitir |
| `CERTIFICATE_IDENTITY_MISMATCH` | Los datos no coinciden con un certificado previo |
| `CERTIFICATE_INVALID_REQUEST` | No se puede emitir el certificado con esos datos |
| `SIGN_QUOTA_EXHAUSTED` | No hay saldo de firma disponible |
| `SIGN_DOCUMENT_CONFLICT` | Ese `documentId` ya se firmó con otro contenido |

### session-recovery

La sesión dejó de servir.

| Código | Cuándo aparece | Acción |
|----|----|----|
| `SESSION_NOT_FOUND` | La sesión no existe | Crear una sesión nueva |
| `SESSION_EXPIRED` | La sesión venció | Crear una sesión nueva |
| `SESSION_TERMINAL` | La sesión ya terminó | Crear una sesión nueva |
| `INVALID_CLIENT_CREDENTIAL` | La credencial efímera no sirve para esa sesión | La Hosted UI intenta renovarla |
| `EXPIRED_CLIENT_CREDENTIAL` | La credencial efímera venció | La Hosted UI la renueva sola |
| `REVOKED_CLIENT_CREDENTIAL` | Fue revocada por una renovación posterior | La Hosted UI la renueva sola |

Las tres credenciales efímeras se resuelven solas dentro de la Hosted UI: renueva y sigue, sin sacar al titular del paso. Solo las tres de sesión requieren que tu backend cree una sesión nueva.

## Códigos públicos del browser

Los eventos `lakaut.flow.failed` traen este envelope:

```
{
  type: "lakaut.flow.failed";
  errorCode: string;    // uno de los códigos de abajo
  safeMessage?: string; // texto seguro para mostrar
  retryable: boolean;
}
```

Los valores posibles de `errorCode` son el tipo `LakautSdkErrorCode`, exportado por `@lakaut/browser` — 34 valores, no la lista más corta que circulaba antes:

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>No uses `SdkPublicErrorCode` para tipar esto

`@lakaut/browser` también exporta `SdkPublicErrorCode`, pero es **otro tipo**: un subconjunto de 19 valores que el SDK usa internamente para validar los mensajes de la Hosted UI. Si tipás tu manejo de errores con ese, 17 de los 34 códigos de abajo te van a quedar afuera. Para `event.errorCode` y para `categoryFor()`, el tipo correcto es `LakautSdkErrorCode`.

| Código | Significado |
|----|----|
| `expired_session` | La sesión venció antes de montar la Hosted UI |
| `invalid_token` | El `clientToken` no es válido o ya se usó |
| `origin_mismatch` | El origen del mensaje entrante no coincide con el esperado |
| `init_timeout` | La Hosted UI no confirmó inicialización dentro de los 15 segundos de espera |
| `init_rejected` | La Hosted UI rechazó la inicialización |
| `session_expired` | La sesión venció durante el flujo |
| `flow_step_not_allowed` | El backend devolvió un paso que no corresponde al flujo |
| `config_invalid` | Configuración incompatible |
| `request_timeout` | Una operación tardó demasiado |
| `attempts_exceeded` | Se agotaron los intentos |
| `network_error` | Falla de red entre el browser y el proveedor o Auth |
| `provider_error` | El proveedor de identidad devolvió un error |
| `unsupported_step` | El paso no está soportado por esta versión |
| `step_timeout` | Un paso puntual del flujo (no la sesión completa) tardó demasiado |
| `provider_unavailable` | El proveedor de identidad no está disponible |
| `frame_blocked` | CSP, contexto no seguro o configuración de framing impiden embeber al proveedor |
| `provider_declined` | El proveedor rechazó continuar con la operación |
| `identity_pending` | La identidad sigue en revisión |
| `identity_retryable_failed` | Identidad rechazada, con reintento posible |
| `identity_final_failed` | Identidad rechazada definitivamente |
| `identity_max_attempts` | Se agotaron los intentos de identidad |
| `identity_support_required` | Requiere intervención de soporte |
| `identity_provider_unavailable` | El proveedor de identidad no está disponible |
| `identity_camera_blocked` | Cámara o permisos bloqueados |
| `identity_frame_blocked` | CSP o framing impiden al proveedor de identidad |
| `identity_technical_failed` | Falla técnica durante la validación de identidad |
| `certificate_failed` | No se pudo emitir el certificado |
| `certificate_pin_invalid` | El PIN del certificado es inválido |
| `certificate_issuance_unavailable` | El servicio de emisión de certificados no está disponible |
| `signing_key_invalid` | La clave de firma no es válida |
| `document_unavailable` | El documento a firmar no está disponible |
| `signing_failed` | No se pudo firmar el documento |
| `signed_document_delivery_failed` | No se pudo entregar el PDF firmado al integrador |
| `unknown` | Código no reconocido — trátalo como no reintentable hasta confirmar la causa |

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>`signed_document_delivery_failed` es especial

Si lo recibís, **el documento ya está firmado**. No lo vuelvas a firmar: reconciliá la copia consultando el estado del documento desde tu backend.

`init_timeout` y `unknown` son casos reales, no teóricos: el primero lo dispara el propio renderer si la Hosted UI no confirma inicialización en 15 segundos; el segundo aparece cuando el evento entrante no trae un código reconocible. Cubrí ambos en tu manejo de errores — un `switch` que solo cubra la lista anterior (más corta) los deja sin capturar.

## Qué conservar en un reintento

Ante una clave incorrecta o un error temporal de firma:

- conservar la sesión;
- conservar el documento;
- conservar el paso actual;
- borrar solamente el PIN;
- impedir el doble envío mientras la solicitud está en curso.

No obligues al titular a repetir OTP, identidad o certificado. Todo eso ya está hecho y la sesión lo recuerda.

## Respuestas HTTP

| Estado | Interpretación |
|---:|----|
| `400` / `422` | Entrada o estado inválido |
| `401` | Credencial inválida o vencida |
| `402` | Sin saldo de firma (`SIGN_QUOTA_EXHAUSTED`) |
| `403` | Integrador inválido, o el origen no coincide con el de la sesión |
| `404` | Sesión o recurso inexistente |
| `409` | Conflicto con el estado actual |
| `429` | Límite temporal; respetar la espera |
| `5xx` | Falla temporal de servicio o proveedor |

El mismo código puede salir con distinto status según el endpoint: `OTP_INVALID` es `400` en el contrato de sesión y `422` en el del orquestador. **Decidí siempre por el código, nunca por el status.**

## Diagnóstico mínimo

Registrá de forma estructurada:

```
environment
integratorId
sessionId
documentId, si aplica
correlationId
errorCode
timestamp
```

`correlationId` es la clave para que soporte pueda seguir el rastro de un titular concreto. Guardalo siempre.

Nunca registres:

```
API key
clientToken
OTP
DNI o sexo
PIN
PDF
evidencia biométrica
JWT
```
