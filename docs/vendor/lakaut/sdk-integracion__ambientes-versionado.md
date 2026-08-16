<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/ambientes-versionado -->

# Ambientes, pruebas y versiones

## Valores de `environment`

El SDK acepta tres valores, no dos:

| Valor | Para qué |
|----|----|
| `"local"` | Desarrollo local. No exige HTTPS ni un origen público — podés usar `localhost` o `127.0.0.1`. |
| `"sandbox"` | Preproducción. Hoy no aplica ninguna restricción de origen a nivel SDK (esa validación solo se activa en `"production"`) — no dependas de que `sandbox` rechace un origen inválido. |
| `"production"` | Producción. Exige un origen HTTPS real: rechaza `localhost`, `127.0.0.1`, cualquier hostname con `sandbox`, y comodines. |

Un webhook nunca llega con `environment: "local"` — ese valor no forma parte del contrato de webhooks, solo del de sesión.

## Preproducción

Valores públicos actuales:

| Recurso | URL |
|----|----|
| Registro npm | `https://packages-preprod.lakautac.com.ar/repository/lakaut-sdk/` |
| Auth | `https://auth-preprod.lakautac.com.ar` |
| Dashboard | `https://web-preprod.lakautac.com.ar/dashboard/integrators` |
| Hosted UI | `https://sdk-preprod.lakautac.com.ar` — el origen exacto llega en la respuesta de creación de sesión |

Lakaut te asigna la integración y el alcance comercial. A partir de ahí, la credencial de Nexus, la API key SDK, los dominios permitidos y el webhook los administrás vos desde el dashboard, sin trámite — ver [Credenciales y accesos](/documentacion-docusaurus-preprod/docs/sdk-integracion/credenciales). El `integratorId` es el slug de tu integración y no cambia.

El `allowedOrigin` que mandás en cada sesión se valida contra los dominios que declaraste y queda vinculado a la credencial efímera de esa sesión. Guardar la configuración sube la revisión (`Config v*n*`); la propagación a los runtimes no es instantánea, así que no declares un origen y lances tráfico en el mismo segundo.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>Producción

Las URLs, credenciales y registro de producción son `TBD`. No uses fallbacks a preproducción en una configuración productiva.

## Variables recomendadas

```
LAKAUT_ENVIRONMENT=sandbox
LAKAUT_AUTH_BASE_URL=https://auth-preprod.lakautac.com.ar
LAKAUT_INTEGRATOR_ID=valor-secreto
LAKAUT_API_KEY=valor-secreto
LAKAUT_ALLOWED_ORIGIN=https://app-preprod.integrador.example
# Sólo si configuraste un webhook:
LAKAUT_WEBHOOK_SECRET=valor-secreto
```

No definas la API key en variables expuestas por Vite, Next.js o el bundler del frontend.

Estos valores no se autogeneran. La API key y el acceso al registro npm los emitís vos desde [Credenciales y accesos](/documentacion-docusaurus-preprod/docs/sdk-integracion/credenciales), y ahí mismo los rotás o revocás.

## Matriz mínima de pruebas

Antes de solicitar promoción, verificá:

- OTP correcto, incorrecto, vencido y reenvío;
- DNI/sexo proporcionados por backend;
- DNI/sexo omitidos y capturados por Hosted UI;
- Veriff en desktop y dispositivo móvil;
- usuario nuevo sin certificado;
- usuario con certificado vigente;
- clave de firma correcta e incorrecta;
- doble clic durante firma;
- timeout o error temporal;
- PDF proporcionado por el integrador;
- PDF cargado por el usuario;
- descarga no vacía con cabecera PDF;
- entrega del PDF al backend;
- falla de entrega sin segunda firma y con descarga disponible;
- consulta autoritativa del documento;
- cancelación, expiración y recarga;
- CSP, cámara y micrófono;
- alta del webhook, copia única del secreto y challenge firmado;
- evento real con HMAC válido, body alterado rechazado y duplicado deduplicado;
- rotación conservando el destino anterior hasta verificar y usando luego la clave nueva;
- baja del destino y ausencia de entregas posteriores;
- ausencia de secretos en bundle y logs.

Usá usuarios y documentos sintéticos o autorizados para pruebas.

## Versiones

Fijá versiones exactas y mantené los tres paquetes en el mismo release:

```
{
  "dependencies": {
    "@lakaut/browser": "0.1.0-rc.34",
    "@lakaut/server": "0.1.0-rc.34",
    "@lakaut/shared-contracts": "0.1.0-rc.34"
  }
}
```

No combines versiones candidatas diferentes.

## Proceso de actualización

1.  recibir de Lakaut la versión candidata;
2.  actualizar `package.json` y lockfile;
3.  ejecutar tests unitarios y build;
4.  desplegar en el ambiente de prueba del integrador;
5.  ejecutar la matriz end-to-end;
6.  revisar cambios de contratos y errores;
7.  promover a producción cuando el ambiente esté disponible.

## Rollback

Conservá la versión anterior en el historial del lockfile y de tu artefacto. Si una actualización falla:

1.  detené la promoción;
2.  restaurá la versión exacta anterior;
3.  reconstruí el artefacto;
4.  validá el flujo mínimo;
5.  informá a Lakaut con los IDs de correlación.

## Criterio de aceptación

Una integración no está completa hasta que:

- el backend confirma el estado;
- el integrador recibió la copia y aplicó la validación server-side requerida por su caso;
- el usuario puede descargar su copia;
- los reintentos no duplican firmas;
- las credenciales no aparecen en el browser;
- los flujos funcionan con el origen HTTPS configurado en su backend.
