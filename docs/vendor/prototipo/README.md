# Prototipo Lucero v2 — Originación vehicular

Distilled from `prototipo-lucero-v2.dc.html` (design prototype, 2026-08-16).
Where this brief and the HTML disagree, **the HTML wins** — read it directly.

This is the *first* client product built on the core, not the core itself. It is
included so the investigation has a concrete instance to generalise from.

## Shape

A three-act demo, switching between a desktop surface (the originador) and a
phone surface (the deudor).

| Act | Actor | Surface |
| --- | --- | --- |
| 1 · Originador crea | dealership operator | desktop |
| 2 · Deudor firma | borrower | mobile |
| 3 · Originador revisa | dealership operator | desktop |

Screens are labelled `S0`–`S8` in the HTML.

## Act 1 — Originador crea (desktop)

Operator: María Ortega, "Concesionaria Motos del Oeste · Morón", CUIT
30-71234567-8. Sidebar: Préstamos · Nuevo préstamo · Deudores · Reportes.

**S0 · Formulario.** Four field groups:

- **Términos del préstamo** — monto (`$1.900.000`), cuotas (`24`), TNA (`78,0 %`),
  sistema (`Francés`), cuota estimada (`$118.700 / mes`, derived)
- **Datos del deudor** — nombre, DNI (`38.945.221`), CUIL (`27-38945221-4`),
  domicilio
- **Vehículo (prenda)** — marca (`Honda`), modelo (`Wave 110cc`), año (`2024`),
  dominio/chasis (`A123 BCD`)
- **Datos del instrumento** — lugar de pago (deliberately blank), integración de
  consumo para persona física (deliberately `Pendiente`)

**S1 · Vista previa + validación.** Renders the instrument:

> **PAGARÉ CON GARANTÍA PRENDARIA** — N.º 2026-04-0187 · según Res. Gral. 1060/2025

Prose naming debtor, amount in words, 24 cuotas of `$118.700`, first due
`10/08/2026`, TNA 78,0 % sistema francés, prenda con registro over the vehicle,
lugar de pago, and **two signature blocks: "Firma del deudor" and "Firma del
acreedor"**.

A validation panel gates the send. Two blocking rules, both shown as failures:

- **Lugar de pago** — *"requerido para la ejecutabilidad del pagaré"*
- **Integración de consumo** — *"obligatoria cuando el deudor es persona física"*

Until both pass: *"No se puede enviar el instrumento hasta completar…"*. When
they pass: *"Instrumento completo — Todos los campos requeridos están cargados."*

**S2 · Enviado.** Handoff by **WhatsApp** to `+54 9 11 5555-1234`, carrying a
link of the form `https://firma.ejemplo.com/f/8H2K9Q`.

## Act 2 — Deudor firma (mobile)

- **S3 · Bienvenida** — "Hola, Carla", amount, cuotas, vehicle
- **S4 · Revisión** — 24 cuotas, primer vencimiento, costo total `$2.848.800`,
  `Honda Wave · A123 BCD`
- **S5 · Verificación + firma** — **explicitly a placeholder.** Verbatim:
  *"Acá el usuario verifica su identidad y firma con nuestro proveedor
  certificado (Lakaut). Es una integración externa, todavía no maquetada."*
  Sub-labels: "Foto / biometría".
- **S6 · Confirmación** — "¡Listo, Carla!", `Préstamo firmado.pdf` to view or
  download, "Ya podés retirar tu moto"

## Act 3 — Originador revisa (desktop)

**S7 · Panel.** 7 loans. Filters: Todos · Enviado · Firmado · Al día · En mora.
Columns: deudor (+DNI), vehículo, monto, estado. States seen: `Firmado · recién`,
`En mora · 47 d`.

**S8 · Comparación — the centrepiece.** Selecting the defaulted loan (Juan
Domínguez, Corven Energy 110, `$1.450.000`, 47 days overdue) shows two columns:

**Así lo tenés hoy** — a paper pagaré with a scrawled signature, annotated:

- Sin verificación de identidad — no hay certeza de quién firmó
- Sin cálculo de intereses ni punitorios
- Documento suelto, difícil de reunir si hay que reclamar

**Con el sistema** — a *paquete de evidencia*:

- Instrumento con firma digital (`ver PDF`)
- Identidad verificada (**RENAPER**)
- Constancia de inscripción de prenda
- Validación del documento
- Liquidación al día de hoy:

  | Concepto | Monto |
  | --- | --- |
  | Capital | `$1.450.000` |
  | Intereses compensatorios (47 d) | `$145.634` |
  | Intereses punitorios | `$72.817` |
  | **Total a reclamar** | **`$1.668.451`** |

Action: **Descargar paquete de evidencia**.

## Notes for the investigation

- The product's value claim lives in S8, not in the signing step. Signing is the
  means; the enforceable evidence bundle is the end.
- The pagaré carries **two** signature blocks. Whether both parties actually sign
  digitally is unresolved by the prototype.
- Only one of the five evidence items is unambiguously Lakaut's (the signed
  instrument). Identity verification is *probably* Lakaut's; prenda registration
  and liquidation are clearly not.
- Amounts are Argentine-formatted (`.` thousands, `,` decimals). Money must never
  be a float.

## Design tokens (from the prototype's CSS)

Fonts: `IBM Plex Sans` (UI), `IBM Plex Mono` (numerals, labels), `Caveat`
(handwritten signature).

| Token | Value |
| --- | --- |
| bg | `#eceee9` |
| surface | `#fff` |
| border | `#e2e5df` |
| text | `#1a2420` |
| muted | `#8a938c`, `#7f9488` |
| primary | `#1c6b4d` (hover `#175a41`) |
| primary dark | `#16241d` |
| primary tint | `#cfe7db` |
| warning | `#c99a2e` |
