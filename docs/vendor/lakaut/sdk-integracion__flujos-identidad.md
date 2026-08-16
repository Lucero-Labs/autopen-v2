<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/flujos-identidad -->

# Flujos e identidad

## Autenticación passwordless

`PASSWORDLESS_AUTH` solicita el email y envía un OTP. Si el backend ya proporcionó el email, Hosted UI puede avanzar directamente al código.

Los códigos son:

- de un solo uso;
- temporales;
- limitados por intentos y reenvíos;
- validados exclusivamente por Lakaut.

El integrador nunca debe capturar o reenviar el OTP desde su backend.

## Onboarding

`ONBOARDING` ejecuta:

1.  aceptación de términos;
2.  autenticación por email y OTP;
3.  obtención de DNI y sexo, si faltan;
4.  validación de identidad con Veriff;
5.  validación de datos contra RENAPER;
6.  creación del certificado digital y definición de su clave.

Si DNI y sexo fueron proporcionados por el backend, el paso de captura se omite, pero la validación de identidad y RENAPER se realiza igualmente.

## Firma

`SIGNING` está pensado para una persona que ya posee un certificado:

1.  autentica al usuario, salvo que exista una continuación válida;
2.  presenta o solicita el PDF;
3.  muestra la revisión;
4.  solicita la clave del certificado;
5.  firma y entrega el PDF.

La clave incorrecta se puede corregir en la misma pantalla. El SDK conserva la sesión y el documento y borra únicamente el PIN ingresado.

## Onboarding y firma

`ONBOARDING_AND_SIGNING` crea el certificado y continúa con el documento en la misma sesión.

Elegí este flujo cuando ambos procesos forman parte de una sola experiencia. Si la firma puede ocurrir mucho después del alta, usá sesiones separadas.

## Estados de identidad

Durante la verificación pueden observarse estados de alto nivel:

| Estado             | Significado                             |
|--------------------|-----------------------------------------|
| `pending`          | Lakaut continúa procesando              |
| `in_progress`      | La validación está en curso             |
| `approved`         | La identidad fue aprobada               |
| `retryable_failed` | Puede iniciarse un nuevo intento        |
| `final_failed`     | El flujo no puede continuar             |
| `expired`          | La sesión o intento venció              |
| `technical_failed` | Falló un proveedor o componente técnico |

Las señales del widget de Veriff no son la verdad final. Hosted UI reconfirma el resultado con el backend antes de avanzar.

## Recomendaciones para Veriff

- usar HTTPS;
- delegar cámara y micrófono;
- no recargar el iframe mientras se captura identidad;
- evitar navegación o renders que desmonten el componente;
- permitir la apertura del flujo móvil cuando el usuario lo elija;
- mostrar una salida clara si el proveedor está temporalmente indisponible.

## Datos registrales

El contrato actual admite sexo registral `M` o `F`, porque son los valores requeridos por la validación oficial utilizada en este flujo. No envíes valores diferentes en `identitySubject`.
