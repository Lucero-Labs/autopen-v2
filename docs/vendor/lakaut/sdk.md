<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk -->

# SDK de Integración

El SDK de Lakaut te permite incorporar autenticación passwordless, validación de identidad, emisión de certificado digital y firma de documentos con validez legal dentro de tu aplicación web, sin que el titular salga de tu producto.

## Cómo se integra: dos etapas

**1. Configurás tu integración en el panel.** Generás tus credenciales, declarás desde qué dominios se va a abrir la experiencia y a dónde querés recibir los eventos. Se hace una vez, desde la web, sin escribir código.

→ [Credenciales y accesos](/documentacion-docusaurus-preprod/docs/sdk-integracion/credenciales)

**2. La implementás en tu aplicación.** Instalás dos paquetes npm: uno crea la sesión desde tu backend, el otro monta la experiencia en el navegador.

→ [Quickstart](/documentacion-docusaurus-preprod/docs/sdk-integracion/quickstart)

## Los dos paquetes

- **`@lakaut/server`** corre en tu backend. Conserva la API key, crea sesiones y consulta el estado autoritativo.
- **`@lakaut/browser`** monta la Hosted UI de Lakaut dentro de un iframe. El navegador recibe únicamente una credencial efímera y **nunca** ve la API key.

`@lakaut/shared-contracts` trae los tipos TypeScript compartidos y llega de forma transitiva con los otros dos.

Esa división no es un detalle de implementación: es la razón por la que una integración correcta no puede filtrar credenciales al browser.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTQgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTcgMi4zYzMuMTQgMCA1LjcgMi41NiA1LjcgNS43cy0yLjU2IDUuNy01LjcgNS43QTUuNzEgNS43MSAwIDAgMSAxLjMgOGMwLTMuMTQgMi41Ni01LjcgNS43LTUuN3pNNyAxQzMuMTQgMSAwIDQuMTQgMCA4czMuMTQgNyA3IDcgNy0zLjE0IDctNy0zLjE0LTctNy03em0xIDNINnY1aDJWNHptMCA2SDZ2Mmgydi0yeiIgLz48L3N2Zz4=)</span>Estado de la versión

Disponible para integraciones controladas en preproducción. Producción todavía no tiene endpoints ni credenciales públicas; Lakaut los comunica durante el onboarding productivo.

## Flujos soportados

| Flujo | Valor | Qué hace |
|----|----|----|
| Autenticación | `PASSWORDLESS_AUTH` | Valida al titular por OTP |
| Onboarding | `ONBOARDING` | Autentica, valida identidad y emite un certificado |
| Firma | `SIGNING` | Autentica y firma documentos con un certificado existente |
| Onboarding y firma | `ONBOARDING_AND_SIGNING` | Todo en una sola sesión |

Onboarding y firma también pueden ser sesiones independientes: útil cuando el alta sucede en un momento y la firma en otro. Tu backend elige el flujo en cada sesión, dentro del alcance que tengas habilitado.

## Cómo se ve por dentro

Hay tres canales de información y **solo uno es la verdad**: el backend. Los eventos del navegador sirven para mover tu interfaz; nunca para dar una operación por cerrada.

## Recorrido recomendado

1.  [Credenciales y accesos](/documentacion-docusaurus-preprod/docs/sdk-integracion/credenciales) — configurá tu integración
2.  [Quickstart](/documentacion-docusaurus-preprod/docs/sdk-integracion/quickstart) — de cero a un titular firmando
3.  [Arquitectura de integración](/documentacion-docusaurus-preprod/docs/sdk-integracion/arquitectura)
4.  [Backend y sesiones](/documentacion-docusaurus-preprod/docs/sdk-integracion/backend-sesiones)
5.  [Frontend y Hosted UI](/documentacion-docusaurus-preprod/docs/sdk-integracion/frontend-hosted-ui)
6.  [Flujos e identidad](/documentacion-docusaurus-preprod/docs/sdk-integracion/flujos-identidad)
7.  [Documentos y firma](/documentacion-docusaurus-preprod/docs/sdk-integracion/documentos-firma)
8.  [Configurar y rotar el webhook](/documentacion-docusaurus-preprod/docs/sdk-integracion/configurar-webhook)
9.  [Eventos, webhooks y estado](/documentacion-docusaurus-preprod/docs/sdk-integracion/eventos-estado)
10. [Errores y recuperación](/documentacion-docusaurus-preprod/docs/sdk-integracion/errores)
11. [Seguridad](/documentacion-docusaurus-preprod/docs/sdk-integracion/seguridad) — antes de producción
12. [Referencia de API](/documentacion-docusaurus-preprod/docs/sdk-integracion/referencia-api)

¿Integrás con un asistente de programación? Pasale el [contrato para agentes](/documentacion-docusaurus-preprod/docs/sdk-integracion/agentes).

## SDK nuevo e iframe legacy

Esta sección documenta el **SDK nuevo**. La sección [Firma Embebida](/documentacion-docusaurus-preprod/docs/guias-practicas/firma-iframe/intro) corresponde a la integración legacy basada en mensajes `lakaut.init` y `lakaut.load.file`. **Los contratos no son intercambiables.**

En el SDK nuevo: el integrador usa paquetes npm privados, el backend crea la sesión, `HostedUiRenderer` administra el iframe y el handshake, nadie construye mensajes `postMessage` a mano, y la verdad final se consulta desde el backend.
