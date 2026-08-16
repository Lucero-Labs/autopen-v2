<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/credenciales -->

# Credenciales y accesos

Toda integración con el SDK necesita cuatro cosas. Este documento explica de dónde sale cada una, cómo se usa y cómo se rota.

| Qué | Para qué |
|----|----|
| **Acceso Nexus** | Instalar los paquetes `@lakaut/*` desde npm |
| **API key SDK** | Que tu backend cree y administre sesiones |
| **Dominios permitidos** | Autorizar los orígenes desde donde se abre la Hosted UI |
| **Webhook** | Recibir el resultado de cada sesión server-to-server |

Las cuatro se administran desde el mismo lugar: **Integradores → Mi integración**, en tu panel de Lakaut — <a href="https://web-preprod.lakautac.com.ar/dashboard/integrators" target="_blank" rel="noopener noreferrer"><code>https://web-preprod.lakautac.com.ar/dashboard/integrators</code></a> en preproducción (producción: `TBD`, igual que el resto de las URLs de esta guía). No es un panel interno: es la superficie pública a la que entrás vos, una vez que Lakaut te dio el permiso. No hace falta abrir un ticket ni esperar a que alguien te envíe un archivo con secretos.

Para conocer cada bloque y el orden recomendado de primera configuración, empezá por [Panel del integrador](/documentacion-docusaurus-preprod/docs/sdk-integracion/dashboard-integrador).

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTQgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTcgMi4zYzMuMTQgMCA1LjcgMi41NiA1LjcgNS43cy0yLjU2IDUuNy01LjcgNS43QTUuNzEgNS43MSAwIDAgMSAxLjMgOGMwLTMuMTQgMi41Ni01LjcgNS43LTUuN3pNNyAxQzMuMTQgMSAwIDQuMTQgMCA4czMuMTQgNyA3IDcgNy0zLjE0IDctNy0zLjE0LTctNy03em0xIDNINnY1aDJWNHptMCA2SDZ2Mmgydi0yeiIgLz48L3N2Zz4=)</span>Antes de empezar

Un administrador de Lakaut tiene que asignarte una integración y el alcance comercial acordado. Hasta que eso pase, al entrar al link vas a ver el mensaje *"No hay integradores disponibles"* — no es un error tuyo, es que todavía no te dieron el permiso. Pedíselo a tu contacto en Lakaut; una vez asignado, el resto de esta página lo hacés vos.

**Qué es autoservicio y qué no.** El alta inicial de la integración y el alcance comercial contratado (qué recorridos y paquetes tenés habilitados) los administra Lakaut — eso sí requiere pedirlo. Pero una vez asignada la integración, las cuatro cosas de la tabla de arriba las administrás **vos mismo, sin ningún trámite**: emitir y rotar tu API key SDK y tu credencial de Nexus, y agregar o modificar dominios permitidos y el webhook, todo desde esta misma pantalla. No hace falta abrir un ticket para sumar un origen nuevo o cambiar la URL del webhook.

## El dashboard

<img src="/documentacion-docusaurus-preprod/assets/images/dashboard-integrador-resumen-4db68599edbc362ae1c14fc3d4a29efa.png" class="img_ev3q" decoding="async" loading="lazy" width="1517" height="900" alt="Pantalla Mi integración del panel de Lakaut" />

La pantalla se divide en cuatro bloques:

**1. Resumen.** Quién sos ante Lakaut: nombre de la integración, slug, ambiente, responsable técnico y empresa/contrato. El slug (`prueba-banco` en la imagen) es tu `integratorId`: el valor que va en el header `X-Integrator-Id`.

**2. Qué puede usar tu integración.** Los journeys habilitados y, dentro de cada uno, los métodos de autenticación disponibles. En cada sesión tu backend elige una de esas combinaciones. El alcance lo administra Lakaut según tu acuerdo comercial: si necesitás uno que no figura, pedilo por el canal comercial.

**3. Conexión con Lakaut.** Dominios permitidos y webhook.

**4. Credenciales técnicas.** La API key SDK y el acceso Nexus.

Si tu usuario administra más de una integración, el selector de arriba a la derecha te deja cambiar entre ellas. Los cambios sin guardar no se pierden en silencio: el dashboard avisa antes de cambiar de integración o de salir de la página.

## Credenciales técnicas

<img src="/documentacion-docusaurus-preprod/assets/images/dashboard-integrador-conexion-0178e083d95e5b62ba23b6d59ceefdab.png" class="img_ev3q" decoding="async" loading="lazy" width="1517" height="900" alt="Bloques de conexión y credenciales técnicas" />

Se emiten dos credenciales, con propósitos que no se mezclan. Cada una admite **una sola credencial activa**: mientras haya una, el botón muestra *"Ya emitida"* y para obtener un valor nuevo hay que rotar o revocar.

### API key SDK

Autentica a tu **backend** contra la API de Lakaut: crear sesiones, consultar estado, completar y cancelar.

Se envía en dos headers, siempre juntos:

```
X-Integrator-Id: prueba-banco
X-API-Key: <el valor que copiaste del dashboard>
```

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTIgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTUuMDUuMzFjLjgxIDIuMTcuNDEgMy4zOC0uNTIgNC4zMUMzLjU1IDUuNjcgMS45OCA2LjQ1LjkgNy45OGMtMS40NSAyLjA1LTEuNyA2LjUzIDMuNTMgNy43LTIuMi0xLjE2LTIuNjctNC41Mi0uMy02LjYxLS42MSAyLjAzLjUzIDMuMzMgMS45NCAyLjg2IDEuMzktLjQ3IDIuMy41MyAyLjI3IDEuNjctLjAyLjc4LS4zMSAxLjQ0LTEuMTMgMS44MSAzLjQyLS41OSA0Ljc4LTMuNDIgNC43OC01LjU2IDAtMi44NC0yLjUzLTMuMjItMS4yNS01LjYxLTEuNTIuMTMtMi4wMyAxLjEzLTEuODkgMi43NS4wOSAxLjA4LTEuMDIgMS44LTEuODYgMS4zMy0uNjctLjQxLS42Ni0xLjE5LS4wNi0xLjc4QzguMTggNS4zMSA4LjY4IDIuNDUgNS4wNS4zMkw1LjAzLjNsLjAyLjAxeiIgLz48L3N2Zz4=)</span>Nunca en el browser

La API key vive únicamente en el backend. Si llega al navegador —en una variable del bundle, en una respuesta de tu API, en un log del cliente— hay que rotarla. El SDK rechaza explícitamente `apiKey`, `x-api-key` y `X-API-Key` entre los datos que se le pueden pasar al renderer del browser.

### Acceso Nexus

Da acceso de **solo lectura** al registro npm privado donde viven los paquetes `@lakaut/*`. Es una credencial de desarrollo y CI, no de runtime: no sirve para llamar a la API ni para publicar o borrar paquetes.

Se genera con el mismo diálogo que la API key del SDK, identificado como **Credencial de Nexus**.

### Las credenciales se muestran una sola vez

Al generar o rotar se abre el diálogo **Guardá esta credencial ahora**.

> Este valor se muestra una sola vez. Lakaut no puede volver a recuperarlo; si se pierde, deberás rotar la credencial.

Es literal. Para la API key y Nexus, Lakaut guarda solo un hash. El secreto de webhook requiere además una custodia operativa cifrada para firmar eventos, pero su copia visible también se destruye después de entregarla. Nadie —tampoco soporte— puede volver a mostrártelo. Si cerrás sin copiar, el dashboard pide confirmación, pero si insistís el valor se pierde y hay que rotar.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTIgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTYuNSAwQzMuNDggMCAxIDIuMTkgMSA1YzAgLjkyLjU1IDIuMjUgMSAzIDEuMzQgMi4yNSAxLjc4IDIuNzggMiA0djFoNXYtMWMuMjItMS4yMi42Ni0xLjc1IDItNCAuNDUtLjc1IDEtMi4wOCAxLTMgMC0yLjgxLTIuNDgtNS01LjUtNXptMy42NCA3LjQ4Yy0uMjUuNDQtLjQ3LjgtLjY3IDEuMTEtLjg2IDEuNDEtMS4yNSAyLjA2LTEuNDUgMy4yMy0uMDIuMDUtLjAyLjExLS4wMi4xN0g1YzAtLjA2IDAtLjEzLS4wMi0uMTctLjItMS4xNy0uNTktMS44My0xLjQ1LTMuMjMtLjItLjMxLS40Mi0uNjctLjY3LTEuMTFDMi40NCA2Ljc4IDIgNS42NSAyIDVjMC0yLjIgMi4wMi00IDQuNS00IDEuMjIgMCAyLjM2LjQyIDMuMjIgMS4xOUMxMC41NSAyLjk0IDExIDMuOTQgMTEgNWMwIC42Ni0uNDQgMS43OC0uODYgMi40OHpNNCAxNGg1Yy0uMjMgMS4xNC0xLjMgMi0yLjUgMnMtMi4yNy0uODYtMi41LTJ6IiAvPjwvc3ZnPg==)</span>Copiá directo a tu gestor de secretos

No pegues el valor en un archivo temporal, un chat o un ticket. Copialo del diálogo y pegalo directamente donde vaya a vivir: el gestor de secretos de tu backend o de tu CI.

Después de generar, la credencial aparece en la lista con su identificador enmascarado —solo los últimos caracteres— y las acciones disponibles.

### Rotar y revocar

- **Rotar** — emite un valor nuevo y deja de servir el anterior **de inmediato**. No hay período de gracia: entre que rotás y actualizás tu backend, las llamadas con la credencial vieja fallan. Actualizá tu backend inmediatamente después.
- **Revocar** — invalida la credencial sin emitir reemplazo.

Rotá ante cualquier sospecha de exposición: un log que la haya capturado, un repositorio donde se haya commiteado, la salida de un integrante del equipo.

## Conexión con Lakaut

### Dominios permitidos

Un origen HTTPS por línea. Es el conjunto de orígenes desde los que se puede abrir la Hosted UI.

```
https://portal.miempresa.com
https://checkout.miempresa.com
```

Reglas que el sistema aplica al validarlos:

- **HTTPS obligatorio**, con host completo.
- **Sin path, query ni fragment.** Solo esquema, host y puerto opcional.
- El host se normaliza a minúsculas; el puerto se conserva si es explícito.
- **Un origen por línea, enumerado.** Los comodines todavía no se pueden declarar desde este formulario — ver abajo.

### Comodines: todavía no

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>El formulario acepta un comodín pero el guardado falla

Si escribís `https://*.clientes.miempresa.com`, ni el campo ni la validación del formulario se quejan, pero al guardar el control plane lo rechaza con *"Origin must use HTTPS and include a host"*. El mensaje confunde —tu origen **sí** era HTTPS—: el validador no reconoce el `*` como parte de un host y concluye que no hay host.

**Enumerá los orígenes uno por uno.** Si tu aplicación es multi-tenant y crea subdominios sin intervención tuya, hablalo con tu contacto en Lakaut antes de diseñar la integración alrededor de un comodín.

La capacidad existe aguas abajo —el servicio de autenticación entiende comodines de un solo nivel, exige HTTPS y rechaza los que cubrirían un dominio público como `https://*.com.ar`—, pero hoy no hay camino desde el dashboard hasta ahí. Lo documentamos para que no diseñes contando con eso: cuando se habilite, estas serán las reglas.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTQgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTYuMyA1LjY5YS45NDIuOTQyIDAgMCAxLS4yOC0uN2MwLS4yOC4wOS0uNTIuMjgtLjcuMTktLjE4LjQyLS4yOC43LS4yOC4yOCAwIC41Mi4wOS43LjI4LjE4LjE5LjI4LjQyLjI4LjcgMCAuMjgtLjA5LjUyLS4yOC43YTEgMSAwIDAgMS0uNy4zYy0uMjggMC0uNTItLjExLS43LS4zek04IDcuOTljLS4wMi0uMjUtLjExLS40OC0uMzEtLjY5LS4yLS4xOS0uNDItLjMtLjY5LS4zMUg2Yy0uMjcuMDItLjQ4LjEzLS42OS4zMS0uMi4yLS4zLjQ0LS4zMS42OWgxdjNjLjAyLjI3LjExLjUuMzEuNjkuMi4yLjQyLjMxLjY5LjMxaDFjLjI3IDAgLjQ4LS4xMS42OS0uMzEuMi0uMTkuMy0uNDIuMzEtLjY5SDhWNy45OHYuMDF6TTcgMi4zYy0zLjE0IDAtNS43IDIuNTQtNS43IDUuNjggMCAzLjE0IDIuNTYgNS43IDUuNyA1LjdzNS43LTIuNTUgNS43LTUuN2MwLTMuMTUtMi41Ni01LjY5LTUuNy01LjY5di4wMXpNNyAuOThjMy44NiAwIDcgMy4xNCA3IDdzLTMuMTQgNy03IDctNy0zLjEyLTctNyAzLjE0LTcgNy03eiIgLz48L3N2Zz4=)</span>Por qué igual no te conviene

`https://*.miempresa.com` alcanza a **todos** los subdominios, incluidos los que ya no usás. Un subdominio abandonado que todavía apunta a un servicio dado de baja puede ser reclamado por un tercero y usado para montar tu experiencia de firma. Es el mismo motivo por el que OAuth desaconseja comodines en las URL de redirección.

Cuando el comodín esté disponible, apuntalo a un subdominio dedicado que controles entero —`https://*.clientes.miempresa.com`, no `https://*.miempresa.com`— y revisá periódicamente qué registros DNS existen bajo esa rama.

### El comodín no aplica a la sesión

Esta es la parte que suele confundir, y conviene tenerla clara antes de integrar.

Declarar dominios y crear una sesión son cosas distintas. Tu backend manda un `allowedOrigin` **concreto** en el cuerpo de cada sesión, y ese valor queda atado a la credencial efímera. Un patrón nunca puede ocupar ese lugar — ni siquiera cuando el comodín esté disponible en la declaración.

No es una restricción nuestra: la Hosted UI se comunica con tu página por `postMessage`, y ahí el navegador exige un **origen exacto** como destino. Un `postMessage(mensaje, "*")` entregaría los datos de la sesión a cualquier origen que en ese momento tenga el frame, así que está prohibido explícitamente.

Ese `allowedOrigin` se valida contra tu declaración en cada creación de sesión, y falla cerrada: si el origen no está declarado —o si la configuración de tu integración todavía no llegó al servicio— la respuesta es `403 FORBIDDEN_ORIGIN`, sin decirte cuál de las dos cosas pasó. Esa opacidad es a propósito.

En la práctica, tu backend resuelve el origen por request:

```
app.post("/api/lakaut/session", async (req, res) => {
  // El origen sale del request, no de una constante: así una app multi-tenant
  // atiende todos sus dominios con una sola integración.
  const origin = new URL(req.headers.referer ?? `https://${req.headers.host}`).origin;

  if (!ORIGENES_QUE_OPERO.has(origin)) {
    return res.status(400).json({ error: "origen no habilitado" });
  }

  const session = await sessions.createSession({
    flowType: "ONBOARDING_AND_SIGNING",
    allowedOrigin: origin,
    externalUserRef: req.user.id,
  });

  res.json({ session: toRendererContext(session), correlationId: session.correlationId });
});
```

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>Validá el origen contra tu propia lista

En el ejemplo, `ORIGENES_QUE_OPERO` es tuya, y es la pieza que no conviene omitir: sin ella estarías confiando en un header que llega del cliente. Mantenela en tu backend, junto al resto de la configuración de tus tenants.

La declaración en el dashboard define el borde exterior de lo permitido; no reemplaza tu propia validación de qué tenant es legítimo.

### Embeber la Hosted UI en un iframe

Los dominios declarados son los que el navegador va a aceptar como contenedores de la Hosted UI (`Content-Security-Policy: frame-ancestors`).

No hay que pedir nada aparte: al guardar la configuración, los dominios declarados quedan habilitados para crear sesiones y para embeber. Si un dominio puede crear sesiones pero el iframe aparece bloqueado, revisá que el origen esté declarado exactamente como lo sirve el navegador —incluido el puerto, si usás uno no estándar.

Los dos controles son mitades independientes: uno decide si podés **crear la sesión**, el otro si el navegador acepta **embeber el iframe**. Un origen habilitado en uno solo deja el flujo cortado —con sesión pero sin iframe, o al revés—, así que ante un problema verificá los dos.

Si tu integración no tiene ningún dominio declarado, la política sale como `frame-ancestors 'none'`: el iframe queda bloqueado en todas partes. La ausencia de configuración nunca se interpreta como permiso.

### Webhook

La URL HTTPS donde Lakaut avisa el resultado de cada sesión. Guardarla la deja pendiente; después generás un secreto de firma, lo instalás en tu backend y usás **Verificar destino** para hacer una prueba HTTP firmada. Solo un par URL/secreto verificado recibe eventos.

La guía paso a paso —incluidos el challenge, la rotación y la baja— está en [Configurar y rotar el webhook](/documentacion-docusaurus-preprod/docs/sdk-integracion/configurar-webhook). La firma de los eventos de negocio está en [Eventos, webhooks y estado](/documentacion-docusaurus-preprod/docs/sdk-integracion/eventos-estado).

Cada vez que guardás, la configuración sube de versión (el badge **Config v*n***). Los runtimes de Lakaut leen esa revisión; el cambio no es instantáneo en todos los nodos, así que no cambies un origen y lances tráfico en el mismo segundo.

## Instalar los paquetes

Con el acceso Nexus generado, creá un `.npmrc` en tu proyecto o en tu CI:

```
@lakaut:registry=https://packages-preprod.lakautac.com.ar/repository/lakaut-sdk/
//packages-preprod.lakautac.com.ar/repository/lakaut-sdk/:_auth=${LAKAUT_NPM_AUTH}
always-auth=true
```

`LAKAUT_NPM_AUTH` es el valor que copiaste del diálogo, inyectado desde tu gestor de secretos. No lo escribas resuelto en el archivo ni lo commitees. Solo se redirige el scope `@lakaut`: el resto de tus dependencias sigue resolviéndose desde el registro que ya usás.

Al pie del bloque **Credenciales técnicas** —debajo de la lista de credenciales emitidas, visible en la misma captura de más arriba— el dashboard muestra el recuadro **Instalación autorizada** con los comandos ya apuntados al canal de tu ambiente:

<img src="/documentacion-docusaurus-preprod/assets/images/dashboard-integrador-instalacion-1abd9cf94629540ac12f9d4587eb3b55.png" class="img_ev3q" decoding="async" loading="lazy" width="1517" height="700" alt="Bloque Instalación autorizada con los comandos de instalación para tu canal" />

```
pnpm add @lakaut/browser@preprod
pnpm add @lakaut/server@preprod
```

Instalá `@lakaut/shared-contracts` explícitamente solo si importás sus tipos o validadores; si no, llega de forma transitiva.

### Canal o versión exacta

Un **canal** (`preprod`, `dev`) apunta siempre al último set validado de ese ambiente. Sirve para arrancar y para mantenerte al día mientras integrás.

Una vez que tu integración es estable, **fijá la versión exacta** en `package.json` y en el lockfile:

```
npm install @lakaut/server@0.1.0-rc.34 @lakaut/browser@0.1.0-rc.34
```

Las versiones publicadas son inmutables: una versión exacta te garantiza que el build de hoy y el de dentro de tres meses instalan el mismo código. Un canal, en cambio, se mueve solo cuando Lakaut promueve un set nuevo, y eso puede pasar entre dos builds tuyos sin que cambies nada.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTIgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTYuNSAwQzMuNDggMCAxIDIuMTkgMSA1YzAgLjkyLjU1IDIuMjUgMSAzIDEuMzQgMi4yNSAxLjc4IDIuNzggMiA0djFoNXYtMWMuMjItMS4yMi42Ni0xLjc1IDItNCAuNDUtLjc1IDEtMi4wOCAxLTMgMC0yLjgxLTIuNDgtNS01LjUtNXptMy42NCA3LjQ4Yy0uMjUuNDQtLjQ3LjgtLjY3IDEuMTEtLjg2IDEuNDEtMS4yNSAyLjA2LTEuNDUgMy4yMy0uMDIuMDUtLjAyLjExLS4wMi4xN0g1YzAtLjA2IDAtLjEzLS4wMi0uMTctLjItMS4xNy0uNTktMS44My0xLjQ1LTMuMjMtLjItLjMxLS40Mi0uNjctLjY3LTEuMTFDMi40NCA2Ljc4IDIgNS42NSAyIDVjMC0yLjIgMi4wMi00IDQuNS00IDEuMjIgMCAyLjM2LjQyIDMuMjIgMS4xOUMxMC41NSAyLjk0IDExIDMuOTQgMTEgNWMwIC42Ni0uNDQgMS43OC0uODYgMi40OHpNNCAxNGg1Yy0uMjMgMS4xNC0xLjMgMi0yLjUgMnMtMi4yNy0uODYtMi41LTJ6IiAvPjwvc3ZnPg==)</span>Cómo saber a qué versión apunta un canal

```
npm view @lakaut/server dist-tags
```

## Usarlas: ejemplo concreto

### Crear una sesión desde tu backend

```
curl -X POST https://auth-preprod.lakautac.com.ar/v1/sdk/sessions \
  -H "Content-Type: application/json" \
  -H "X-Integrator-Id: $LAKAUT_INTEGRATOR_ID" \
  -H "X-API-Key: $LAKAUT_API_KEY" \
  -d '{
    "flowType": "ONBOARDING_AND_SIGNING",
    "allowedOrigin": "https://portal.miempresa.com",
    "externalUserRef": "cliente-4821",
    "email": "titular@ejemplo.com",
    "phone": "+5491122334455"
  }'
```

Respuesta:

```
{
  "sessionId": "8f3c1e7a-...",
  "clientToken": "8f3c1e7a-....gT7pQ2mX9vK1nR4sL6wY8zB3",
  "hostedUiUrl": "https://sdk-preprod.lakautac.com.ar/hosted-ui.html",
  "expiresInSeconds": 5400,
  "correlationId": "sdk_2b9d...",
  "journeyId": "journey.onboarding-signing.v1",
  "journeyVersion": 1,
  "authenticationProfileId": "auth.email-sms.v1",
  "authenticationProfileVersion": 1,
  "requiredInputs": ["EMAIL", "PHONE"],
  "identitySubjectStatus": "required",
  "flow_config": {
    "flowKind": "onboarding_and_signing",
    "vocabularyVersion": "1.1.0",
    "steps": [{ "type": "email_otp", "required": true }]
  }
}
```

`expiresInSeconds` es la vida de la **credencial efímera del browser**, no de la sesión. El valor cambia por ambiente —5400 en preproducción, 1800 en desarrollo— así que leelo de la respuesta en vez de asumirlo. `initialStep` solo aparece si mandaste `continuationFromSessionId`.

Con `@lakaut/server`, lo mismo. El transporte guarda las credenciales y el cliente expone las operaciones:

```
import { HttpAuthTransport, SessionClient } from "@lakaut/server";

const transport = new HttpAuthTransport({
  integratorId: process.env.LAKAUT_INTEGRATOR_ID!,
  apiKey: process.env.LAKAUT_API_KEY!,
  baseUrl: process.env.LAKAUT_AUTH_BASE_URL!,
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

const session = await sessions.createSession({
  flowType: "ONBOARDING_AND_SIGNING",
  allowedOrigin: "https://portal.miempresa.com",
  externalUserRef: "cliente-4821",
});
```

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>La respuesta del SDK no es el JSON crudo

`createSession()` devuelve la forma normalizada: `hostedUiOrigin` (un origen, no una URL completa), `expiresAt` (timestamp absoluto, no segundos) y `flowConfig` en camelCase. El `flow_config` en snake_case aparece solo si consumís el endpoint HTTP directamente.

La referencia completa de cada método y cada tipo está en [Referencia de API](/documentacion-docusaurus-preprod/docs/sdk-integracion/referencia-api).

### Qué mandarle al browser

Exactamente lo que devuelve `toRendererContext()`. El `clientToken` sí; la API key **nunca**:

```
{
  "sessionId": "8f3c1e7a-...",
  "clientToken": "8f3c1e7a-....gT7pQ2mX9vK1nR4sL6wY8zB3",
  "clientTokenExpiresAt": "2026-08-13T18:42:11.000Z",
  "hostedUiOrigin": "https://sdk-preprod.lakautac.com.ar",
  "allowedOrigin": "https://portal.miempresa.com",
  "environment": "sandbox",
  "flowConfig": { "flowKind": "onboarding_and_signing", "steps": [] },
  "identitySubjectStatus": "required"
}
```

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTQgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTYuMyA1LjY5YS45NDIuOTQyIDAgMCAxLS4yOC0uN2MwLS4yOC4wOS0uNTIuMjgtLjcuMTktLjE4LjQyLS4yOC43LS4yOC4yOCAwIC41Mi4wOS43LjI4LjE4LjE5LjI4LjQyLjI4LjcgMCAuMjgtLjA5LjUyLS4yOC43YTEgMSAwIDAgMS0uNy4zYy0uMjggMC0uNTItLjExLS43LS4zek04IDcuOTljLS4wMi0uMjUtLjExLS40OC0uMzEtLjY5LS4yLS4xOS0uNDItLjMtLjY5LS4zMUg2Yy0uMjcuMDItLjQ4LjEzLS42OS4zMS0uMi4yLS4zLjQ0LS4zMS42OWgxdjNjLjAyLjI3LjExLjUuMzEuNjkuMi4yLjQyLjMxLjY5LjMxaDFjLjI3IDAgLjQ4LS4xMS42OS0uMzEuMi0uMTkuMy0uNDIuMzEtLjY5SDhWNy45OHYuMDF6TTcgMi4zYy0zLjE0IDAtNS43IDIuNTQtNS43IDUuNjggMCAzLjE0IDIuNTYgNS43IDUuNyA1LjdzNS43LTIuNTUgNS43LTUuN2MwLTMuMTUtMi41Ni01LjY5LTUuNy01LjY5di4wMXpNNyAuOThjMy44NiAwIDcgMy4xNCA3IDdzLTMuMTQgNy03IDctNy0zLjEyLTctNyAzLjE0LTcgNy03eiIgLz48L3N2Zz4=)</span>`hostedUiOrigin`, no `hostedUiUrl`

El contexto del renderer lleva el **origen**, no la URL completa: `HostedUiRenderer` arma el `src` del iframe y valida el `targetOrigin` de cada `postMessage` a partir de ese valor. `hostedUiUrl` solo existe en la respuesta HTTP cruda de Auth. Si armás el objeto a mano con `hostedUiUrl`, el renderer no monta.

### La credencial efímera del browser

El `clientToken` es de un solo uso por sesión y viaja como `Authorization: Bearer`. Su vigencia la fija el ambiente: hoy **30 minutos en desarrollo, 90 en preproducción**, y 15 minutos si el servicio corre sin configurar. No la hardcodees — el valor viene en `expiresInSeconds` (o en `clientTokenExpiresAt`, ya como timestamp absoluto, si usás `toRendererContext()`).

La Hosted UI lo renueva sola al 70 % de su vida útil contra `POST /v1/sdk/sessions/{sessionId}/client-credential/refresh`; vos no tenés que hacer nada. Ese endpoint es el único que se autentica con el propio `clientToken` en vez de la API key.

Al renovar, la credencial anterior queda **revocada**. Nunca hay dos válidas a la vez, y la nueva expiración nunca supera el fin de la sesión.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>El `clientToken` puede sobrevivir a la sesión

El tope por fin de sesión se aplica al **renovar**, no al emitir. Con la configuración por defecto del servicio (sesión de 10 minutos, credencial de 15) la credencial sigue siendo válida después de que la sesión venció. No uses la vigencia del `clientToken` como señal de que la sesión sigue viva: para eso está `getSession()`.

## Separación por ambiente

Desarrollo y preproducción comparten el registro npm, pero **no comparten nada más**: API keys, `integratorId`, sesiones, URLs, orígenes ni secretos de webhook. Producción usa un registro y credenciales completamente separados.

No copies credenciales entre ambientes.

## Si algo falla

| Síntoma | Causa habitual |
|----|----|
| `401` con `UNAUTHORIZED` | Falta `X-Integrator-Id` o `X-API-Key` en la llamada del backend |
| `401` con `INVALID_CLIENT_CREDENTIAL` | El `clientToken` no corresponde a esa sesión, o ya fue revocado por una renovación |
| `401` con `INTEGRATOR_DISABLED` | La integración está deshabilitada; contactá a Lakaut |
| `403` con `FORBIDDEN_ORIGIN` | El header `Origin` no coincide con el origen vinculado a la sesión |
| `403` con `INTEGRATOR_ROUTED_TO_LEGACY` | Tu integración todavía apunta a la integración legacy por iframe |
| `npm install` da `401` | `LAKAUT_NPM_AUTH` vacío, mal inyectado, o el acceso Nexus fue rotado |
| El webhook sigue pendiente | Todavía no generaste el secreto o el challenge firmado no terminó bien |
| El webhook aparece rechazado | Revisá TLS, DNS público, redirects, timeout, firma y `proof` del challenge |

El significado completo de cada código y qué hacer con él está en [Errores y recuperación](/documentacion-docusaurus-preprod/docs/sdk-integracion/errores).
