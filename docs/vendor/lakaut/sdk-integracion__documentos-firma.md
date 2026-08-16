<!-- source: https://lakaut-fd.github.io/documentacion-docusaurus-preprod/docs/sdk-integracion/documentos-firma -->

# Documentos y firma

El SDK admite dos formas de obtener el PDF de entrada.

## Opción A: documento proporcionado por el integrador

El backend o gestor documental del integrador obtiene el archivo y el frontend lo entrega al renderer como `ArrayBuffer`:

```
const pdfResponse = await fetch("/api/contracts/contract-42/pdf");
if (!pdfResponse.ok) throw new Error("No se pudo obtener el documento");

const pdfBytes = await pdfResponse.arrayBuffer();

const renderer = new HostedUiRenderer({
  session,
  container: document.querySelector("#lakaut-hosted-ui"),
  document: {
    documentId: "contract-42",
    fileName: "contrato.pdf",
    mimeType: "application/pdf",
    bytes: pdfBytes,
  },
  onDocumentSigned: saveSignedDocument,
  on: handleLifecycleEvent,
});
```

Validaciones del documento:

| Campo        | Regla                                                   |
|--------------|---------------------------------------------------------|
| `documentId` | 1 a 120 caracteres: letras, números, `.`, `_`, `:`, `-` |
| `fileName`   | 1 a 180 caracteres                                      |
| `mimeType`   | `application/pdf`                                       |
| `bytes`      | `ArrayBuffer` con cabecera `%PDF-`                      |
| Tamaño       | Máximo 20 MB para el PDF de entrada                     |

## Opción B: carga manual

Si omitís `document`, Hosted UI muestra al usuario un selector de archivos:

```
const renderer = new HostedUiRenderer({
  session,
  container,
  onDocumentSigned: saveSignedDocument,
  on: handleLifecycleEvent,
});
```

Esta opción es útil cuando el integrador todavía no tiene el PDF en su sistema.

## Recibir una copia del PDF firmado

`onDocumentSigned` recibe en el browser una copia del artefacto que debe tratarse como entrada no confiable:

```
async function saveSignedDocument(artifact) {
  const body = new FormData();
  body.append(
    "file",
    new Blob([artifact.bytes], { type: artifact.mimeType }),
    artifact.fileName,
  );
  body.append("sessionId", artifact.sessionId);
  body.append("documentId", artifact.documentId);
  body.append("finalPdfHash", artifact.finalPdfHash);

  const response = await fetch("/api/lakaut/signed-documents", {
    method: "POST",
    body,
  });

  if (!response.ok) {
    throw new Error("No se pudo guardar el documento firmado");
  }
}
```

El callback debe resolver **después** de que el backend confirme la recepción. Recién entonces el renderer confirma la entrega a Hosted UI.

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTYgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTguODkzIDEuNWMtLjE4My0uMzEtLjUyLS41LS44ODctLjVzLS43MDMuMTktLjg4Ni41TC4xMzggMTMuNDk5YS45OC45OCAwIDAgMCAwIDEuMDAxYy4xOTMuMzEuNTMuNTAxLjg4Ni41MDFoMTMuOTY0Yy4zNjcgMCAuNzA0LS4xOS44NzctLjVhMS4wMyAxLjAzIDAgMCAwIC4wMS0xLjAwMkw4Ljg5MyAxLjV6bS4xMzMgMTEuNDk3SDYuOTg3di0yLjAwM2gyLjAzOXYyLjAwM3ptMC0zLjAwNEg2Ljk4N1Y1Ljk4N2gyLjAzOXY0LjAwNnoiIC8+PC9zdmc+)</span>Recepción no equivale a custodia probatoria

El PDF y `finalPdfHash` llegan desde el mismo browser. Un backend no puede considerarlos autoritativos solamente porque ambos coincidan. Recalculá el hash para detectar errores de transporte, pero confirmá el estado de firma mediante `getSignedDocumentStatus` o el webhook firmado. Para probar que esos bytes exactos contienen la firma válida, usá `verifySignedPdfArtifact` — está más abajo en esta misma página.

El artefacto incluye:

```
interface SignedDocumentArtifact {
  protocolVersion: "1.1.0";
  sessionId: string;
  documentId: string;
  fileName: string;
  mimeType: "application/pdf";
  bytes: ArrayBuffer;
  signedContentHash: string;
  finalPdfHash: string;
  algorithm: "SHA-256" | "SHA-384" | "SHA-512";
  signedAt: string;
}
```

<span class="admonitionIcon_Rf37">![](data:image/svg+xml;base64,PHN2ZyB2aWV3Ym94PSIwIDAgMTQgMTYiPjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgZD0iTTYuMyA1LjY5YS45NDIuOTQyIDAgMCAxLS4yOC0uN2MwLS4yOC4wOS0uNTIuMjgtLjcuMTktLjE4LjQyLS4yOC43LS4yOC4yOCAwIC41Mi4wOS43LjI4LjE4LjE5LjI4LjQyLjI4LjcgMCAuMjgtLjA5LjUyLS4yOC43YTEgMSAwIDAgMS0uNy4zYy0uMjggMC0uNTItLjExLS43LS4zek04IDcuOTljLS4wMi0uMjUtLjExLS40OC0uMzEtLjY5LS4yLS4xOS0uNDItLjMtLjY5LS4zMUg2Yy0uMjcuMDItLjQ4LjEzLS42OS4zMS0uMi4yLS4zLjQ0LS4zMS42OWgxdjNjLjAyLjI3LjExLjUuMzEuNjkuMi4yLjQyLjMxLjY5LjMxaDFjLjI3IDAgLjQ4LS4xMS42OS0uMzEuMi0uMTkuMy0uNDIuMzEtLjY5SDhWNy45OHYuMDF6TTcgMi4zYy0zLjE0IDAtNS43IDIuNTQtNS43IDUuNjggMCAzLjE0IDIuNTYgNS43IDUuNyA1LjdzNS43LTIuNTUgNS43LTUuN2MwLTMuMTUtMi41Ni01LjY5LTUuNy01LjY5di4wMXpNNyAuOThjMy44NiAwIDcgMy4xNCA3IDdzLTMuMTQgNy03IDctNy0zLjEyLTctNyAzLjE0LTcgNy03eiIgLz48L3N2Zz4=)</span>`finalPdfHash` es exclusivo de este artefacto del browser

No se persiste server-side ni viaja en el webhook `auth.document.signed` (ver [Eventos y estado](/documentacion-docusaurus-preprod/docs/sdk-integracion/eventos-estado)) — ahí solo existe `signedContentHash`. Si tu backend necesita el hash de forma autoritativa (no solo lo que reportó el browser), usá `signedContentHash` del webhook o de `getSignedDocumentStatus`.

## Falla de entrega

Si `onDocumentSigned` rechaza:

- no se repite la operación criptográfica;
- el usuario conserva la opción de descargar su copia;
- se emite `signed_document_delivery_failed`.

El integrador debe implementar la carga de forma confiable dentro del callback y hacer idempotente su endpoint de recepción usando, por ejemplo:

```
sessionId + documentId + finalPdfHash
```

## Descargar y entregar no son lo mismo

- El botón de descarga entrega una copia al usuario.
- `onDocumentSigned` transporta una copia no autoritativa al sistema del integrador.
- El webhook `auth.document.signed` entrega una constancia, no el PDF.
- `getSignedDocumentStatus` confirma metadatos autoritativos, no devuelve bytes.

No marques el documento como firmado solo por una descarga o un evento visual.

## Consultar la constancia

Desde el backend:

```
const receipt = await sessions.getSignedDocumentStatus(
  sessionId,
  "contract-42",
);
```

La respuesta confirma:

- estado `SIGNED`;
- hash del contenido firmado;
- algoritmo;
- referencia del certificado;
- fingerprint del certificado firmante;
- fecha de firma;
- `correlationId`.

## Custodia probatoria: `verifySignedPdfArtifact`

Si necesitás probar que **esos bytes exactos** contienen la firma válida, no hace falta coordinar ningún mecanismo con Lakaut: `@lakaut/server` ya lo trae. `verifySignedPdfArtifact` extrae la firma CMS separada del PDF, la valida contra el contenido firmado y cruza el artefacto que llegó por el browser con el estado autoritativo.

```
import {
  verifySignedPdfArtifact,
  OpenSslCmsVerifier,
  SignedDocumentVerificationError,
} from "@lakaut/server";

const cmsVerifier = new OpenSslCmsVerifier();

async function custodiar(artifact) {
  const authority = await sessions.getSignedDocumentStatus(
    artifact.sessionId,
    artifact.documentId,
  );

  try {
    const evidence = await verifySignedPdfArtifact(artifact, authority, { cmsVerifier });
    await guardarConEvidencia(artifact.bytes, evidence);
  } catch (error) {
    if (error instanceof SignedDocumentVerificationError) {
      // No guardes el artefacto como probatorio: error.code dice por qué falló.
      return registrarFalloDeCustodia(artifact, error.code);
    }
    throw error;
  }
}
```

Son **tres argumentos posicionales** —el artefacto, el estado autoritativo y las opciones—, no un objeto único. `OpenSslCmsVerifier` es la implementación provista de `DetachedCmsVerifier`: necesita `openssl` disponible en el entorno del backend. Si preferís otra, implementá la interfaz y pasala en `cmsVerifier`.

La evidencia que devuelve es lo que conviene archivar junto al PDF:

```
interface SignedPdfVerificationEvidence {
  version: "1";
  sessionId: string;
  documentId: string;
  algorithm: SignatureAlgorithm;
  signedContentHash: string;
  finalPdfHash: string;
  signerCertificateFingerprint: string;
  certificateRef: string;
  signedAt: string;
  correlationId: string;
  verifiedAt: string;
}
```

Los fallos llegan como `SignedDocumentVerificationError` con un `code` que distingue el motivo:

| `code` | Qué pasó |
|----|----|
| `invalid_signed_document_input` | El artefacto o el estado no tienen la forma esperada — típicamente, argumentos mal pasados |
| `signed_document_authority_mismatch` | El artefacto no corresponde a ese estado autoritativo |
| `signed_pdf_hash_mismatch` | Los bytes recibidos no coinciden con `finalPdfHash` |
| `signed_pdf_content_hash_mismatch` | El contenido firmado no coincide con `signedContentHash` |
| `signed_document_verification_failed` | La firma CMS no valida contra el contenido |
| `signed_document_verifier_unavailable` | El verificador no está disponible en tu entorno |
| `signed_document_verifier_timeout` | El verificador no respondió a tiempo |
| `signed_document_verifier_busy` | El verificador está saturado |

Los tres últimos son problemas de tu entorno, no del documento: reintentá antes de concluir que la firma es inválida.

## Más de un documento

Una sesión de firma permanece activa hasta `completeSession`. Para varios documentos:

1.  procesá cada documento de forma secuencial;
2.  asigná un `documentId` único;
3.  recibí cada PDF y aplicá la validación server-side exigida por tu caso;
4.  consultá sus constancias;
5.  completá la sesión cuando no queden documentos pendientes.
