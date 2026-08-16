<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/dashboard-integrador -->

# Panel del integrador

El panel **Integradores → Mi integración** es el lugar de autoservicio para revisar el alcance contratado y preparar la conexión técnica con Lakaut. Esta guía describe lo que ve y puede hacer un integrador; no incluye las herramientas internas del CMS de Lakaut.

En preproducción se accede desde <a href="https://web-preprod.lakautac.com.ar/dashboard/integrators" target="_blank" rel="noopener noreferrer"><code>https://web-preprod.lakautac.com.ar/dashboard/integrators</code></a>. La URL productiva se publica durante el alta de producción.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTQgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTcgMi4zYzMuMTQgMCA1LjcgMi41NiA1LjcgNS43cy0yLjU2IDUuNy01LjcgNS43QTUuNzEgNS43MSAwIDAgMSAxLjMgOGMwLTMuMTQgMi41Ni01LjcgNS43LTUuN3pNNyAxQzMuMTQgMSAwIDQuMTQgMCA4czMuMTQgNyA3IDcgNy0zLjE0IDctNy0zLjE0LTctNy03em0xIDNINnY1aDJWNHptMCA2SDZ2Mmgydi0yeiIgLz48L3N2Zz4=)</span>Requisito previo

Un administrador de Lakaut debe asignarte al menos una integración. Si la pantalla dice **No hay integradores disponibles**, pedí la asignación a tu contacto en Lakaut. No es un problema de tus credenciales de acceso.

## Qué administra cada parte

| Elemento                            | Quién lo administra                |
|-------------------------------------|------------------------------------|
| Alta inicial, empresa y responsable | Lakaut                             |
| Recorridos y métodos contratados    | Lakaut, según el acuerdo comercial |
| Paquetes SDK habilitados y canal    | Lakaut                             |
| Dominios permitidos                 | El integrador desde el panel       |
| URL y verificación del webhook      | El integrador desde el panel       |
| API key SDK y acceso Nexus          | El integrador desde el panel       |

Esta separación es importante: el panel permite operar la integración, pero no ampliar un contrato ni habilitar recorridos por cuenta propia.

## 1. Resumen y alcance contratado

<img src="/documentacion-docusaurus-preprod/assets/images/dashboard-integrador-resumen-4db68599edbc362ae1c14fc3d4a29efa.png" class="img_ev3q" decoding="async" loading="lazy" width="1517" height="900" alt="Resumen y alcance contratado en Mi integración" />

La cabecera identifica la integración seleccionada. Las tres tarjetas muestran:

- **Nombre de la integración:** nombre visible, `slug`, estado y ambiente. El `slug` es el `integratorId` que usa tu backend.
- **Responsable técnico:** persona o cuenta responsable de la operación.
- **Empresa / contrato:** referencia comercial asociada por Lakaut.

El bloque **Qué puede usar tu integración** es de solo lectura. Agrupa el alcance por recorrido:

- **Onboarding:** alta y validación de identidad sin firma.
- **Firma:** firma para una identidad ya disponible.
- **Onboarding y firma:** ambos recorridos dentro de una misma sesión.

Cada tarjeta enumera únicamente los métodos contratados para ese recorrido. Según el alta comercial pueden aparecer **Email + SMS**, **solo Email**, **solo SMS** o una combinación de ellos. La captura muestra un ejemplo, no un catálogo universal.

Al pie aparecen los paquetes npm autorizados y el canal correspondiente al ambiente. Si falta un recorrido, método o paquete, no intentes corregirlo generando otra credencial: pedí que Lakaut revise el alcance comercial.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTQgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTYuMyA1LjY5YS45NDIuOTQyIDAgMCAxLS4yOC0uN2MwLS4yOC4wOS0uNTIuMjgtLjcuMTktLjE4LjQyLS4yOC43LS4yOC4yOCAwIC41Mi4wOS43LjI4LjE4LjE5LjI4LjQyLjI4LjcgMCAuMjgtLjA5LjUyLS4yOC43YTEgMSAwIDAgMS0uNy4zYy0uMjggMC0uNTItLjExLS43LS4zek04IDcuOTljLS4wMi0uMjUtLjExLS40OC0uMzEtLjY5LS4yLS4xOS0uNDItLjMtLjY5LS4zMUg2Yy0uMjcuMDItLjQ4LjEzLS42OS4zMS0uMi4yLS4zLjQ0LS4zMS42OWgxdjNjLjAyLjI3LjExLjUuMzEuNjkuMi4yLjQyLjMxLjY5LjMxaDFjLjI3IDAgLjQ4LS4xMS42OS0uMzEuMi0uMTkuMy0uNDIuMzEtLjY5SDhWNy45OHYuMDF6TTcgMi4zYy0zLjE0IDAtNS43IDIuNTQtNS43IDUuNjggMCAzLjE0IDIuNTYgNS43IDUuNyA1LjdzNS43LTIuNTUgNS43LTUuN2MwLTMuMTUtMi41Ni01LjY5LTUuNy01LjY5di4wMXpNNyAuOThjMy44NiAwIDcgMy4xNCA3IDdzLTMuMTQgNy03IDctNy0zLjEyLTctNyAzLjE0LTcgNy03eiIgLz48L3N2Zz4=)</span>Varias integraciones

Si tu usuario administra más de una integración, la cabecera muestra el selector **Integración seleccionada**. Cambiar de integración actualiza todos los bloques. Si hay cambios técnicos sin guardar, el panel pide confirmación antes de descartarlos.

## 2. Conexión con Lakaut

<img src="/documentacion-docusaurus-preprod/assets/images/dashboard-integrador-conexion-0178e083d95e5b62ba23b6d59ceefdab.png" class="img_ev3q" decoding="async" loading="lazy" width="1517" height="900" alt="Dominios permitidos y webhook backend" />

Este bloque configura dónde puede abrirse la Hosted UI y dónde se reciben los eventos.

### Dominios permitidos

Ingresá un origen HTTPS completo por línea, por ejemplo:

```
https://portal.empresa.example
https://clientes.empresa.example
```

Un origen no lleva path, query ni fragmento. El puerto forma parte del origen cuando es explícito. El `allowedOrigin` enviado al crear una sesión debe coincidir con uno de los orígenes guardados.

### Webhook backend

La URL debe ser HTTPS y pertenecer a un endpoint server-to-server del integrador. El flujo normal es:

1.  guardar la URL;
2.  generar el secreto de firma;
3.  instalarlo en el backend;
4.  seleccionar **Verificar destino**;
5.  confirmar que el estado quede verificado antes de depender de los eventos.

La guía completa está en [Configurar y rotar el webhook](/documentacion-docusaurus-preprod/docs/sdk-integracion/configurar-webhook).

### Versión y estado

El badge **Config vN** identifica la revisión de configuración. El otro badge resume su estado:

| Estado | Significado |
|----|----|
| **Borrador** | La configuración todavía no está lista para operar completamente |
| **Activo** | La integración está habilitada para el alcance asignado |
| **No configurado** | Esa parte, por ejemplo el webhook, todavía no fue preparada |
| **Pendiente de verificar** | El secreto existe, pero falta probar el destino |
| **Verificado** | El destino respondió correctamente a la prueba firmada |
| **Requiere atención** o **Falló** | La activación o verificación necesita revisión |

Guardar crea una nueva revisión. Evitá lanzar tráfico inmediatamente después de un cambio: esperá a que la configuración se propague y hacé una prueba controlada.

## 3. Credenciales técnicas

<img src="/documentacion-docusaurus-preprod/assets/images/dashboard-integrador-credenciales-inicial-532d07b5fa667242202997ba5424cafa.png" class="img_ev3q" decoding="async" loading="lazy" width="1517" height="900" alt="Credenciales técnicas antes de la primera emisión" />

Hay dos credenciales con propósitos separados:

- **API key SDK:** autentica el backend al crear y administrar sesiones.
- **Acceso Nexus:** permite que desarrollo y CI instalen los paquetes npm autorizados.

Seleccionar **Generar** crea una credencial del tipo correspondiente. El secreto se muestra una sola vez; Lakaut no puede volver a recuperarlo. Copialo directamente a un gestor de secretos. Nunca lo guardes en el navegador, el repositorio, un ticket o un chat.

Cuando existe una credencial activa, la tabla muestra su tipo, identificador enmascarado, estado y fecha. Las acciones disponibles son:

- **Rotar:** invalida la anterior y entrega un secreto nuevo de lectura única.
- **Revocar:** invalida la credencial sin reemplazarla.

Ambas acciones pueden interrumpir una integración en uso. Coordiná la actualización del backend o de CI antes de confirmarlas. Para detalles y ejemplos de headers, consultá [Credenciales y accesos](/documentacion-docusaurus-preprod/docs/sdk-integracion/credenciales).

## 4. Instalación autorizada

<img src="/documentacion-docusaurus-preprod/assets/images/dashboard-integrador-instalacion-1abd9cf94629540ac12f9d4587eb3b55.png" class="img_ev3q" decoding="async" loading="lazy" width="1517" height="700" alt="Comandos de instalación autorizados para preproducción" />

El bloque negro muestra los comandos exactos para los paquetes y el canal concedidos a la integración. La captura usa `preprod`; en otro ambiente el canal cambia.

La credencial Nexus se configura en npm o pnpm como un secreto de CI. No se escribe en el comando ni en `package.json`. Después de estabilizar la integración, fijá una versión exacta y conservá el lockfile para que los builds sean reproducibles.

## Recorrido recomendado de primera configuración

1.  Confirmá ambiente, empresa, responsable y alcance contratado.
2.  Copiá el `integratorId` y guardalo en la configuración server-side.
3.  Declará los dominios HTTPS exactos que van a embeber la Hosted UI.
4.  Guardá y verificá el webhook.
5.  Generá la API key SDK y guardala en el backend.
6.  Generá el acceso Nexus y guardalo en desarrollo o CI.
7.  Instalá los paquetes mostrados por el panel.
8.  Ejecutá una sesión de prueba completa y comprobá el evento final en tu backend.

## Si algo no aparece o no funciona

| Síntoma | Qué revisar |
|----|----|
| No hay integraciones disponibles | Asignación del usuario por parte de Lakaut |
| Falta un recorrido o método | Alcance comercial; no se corrige con una API key nueva |
| No aparecen comandos de instalación | Paquetes habilitados para el ambiente |
| No deja guardar dominios | HTTPS, formato de origen y una entrada por línea |
| No deja verificar el webhook | Guardar primero la URL y generar el secreto |
| Se perdió un secreto | Rotar la credencial; el valor anterior no puede recuperarse |
| Una API key dejó de funcionar | Estado, posible rotación/revocación y `integratorId` correcto |

Para diagnosticar una sesión concreta, conservá el `correlationId` y compartilo con soporte. No compartas secretos ni tokens.
