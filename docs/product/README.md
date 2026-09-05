# docs/product

What Lucero is building, as designed. This is the *client product* that sits on
the core, not the core itself.

`prototipo-2026-09-05.html` is the current design prototype, exported from
Claude. It is a bundled React app: `grep` works on it, but reading it means
opening it in a browser. **Where this brief and the prototype disagree, the
prototype wins.**

The previous prototype (2026-08-16) stays at `docs/vendor/prototipo/` because
RESULT-001 cites it as `[proto]` and `[brief]` and is never edited. It is
superseded, not history to consult.

## Shape

Three acts, two surfaces: an originador on desktop, a deudor on a phone.

| Act | Actor | Surface |
| --- | --- | --- |
| 1 · Originador crea | lender operator | desktop |
| 2 · Deudor firma | debtor | mobile |
| 3 · Originador revisa | lender operator | desktop |

The operator is María Ortega at **Crédito del Oeste S.A. · Morón**, CUIT
30-71234567-8 — a lender. Sidebar: Pagarés · Nuevo pagaré · Deudores · Reportes.

## Act 1 — Originador crea

**Nuevo pagaré.** The operator enters terms and a phone number, and nothing about
the debtor:

- **Términos** — monto (`$1.900.000`), cuotas (`24`), TNA (`78,0 %`), primer
  vencimiento (`10/09/2026`), cuota estimada (`$118.700 / mes`, sistema francés,
  derived)
- **Pagadero a la orden de** — beneficiario (`Crédito del Oeste S.A.`)
- **Lugar de pago** — deliberately `Sin completar`
- **Enviar a** — WhatsApp del deudor (`+54 9 11 5555-1234`)

> Nombre, DNI y domicilio los carga el deudor al crear su cuenta. Se verifican
> antes de la firma.

**Vista previa.** Renders `PAGARÉ A LA ORDEN · N.º 2026-08-0187 · sin protesto`,
the *sin protesto* clause under art. 50, and a signature block for the
**suscriptor** only. The gate is stated as:

> Verificamos los requisitos del art. 101 del Decreto-Ley 5965/63 antes de
> enviarlo a firmar.

Seven requisitos are listed, and they are not all the originador's to satisfy:

| # | Requisito | Satisfied by |
| --- | --- | --- |
| 1 | Cláusula «a la orden» / denominación | originador |
| 2 | Promesa pura y simple de pagar suma determinada | originador |
| 3 | Plazo de pago | originador |
| 4 | Indicación del lugar de pago | originador |
| 5 | Nombre de aquel a cuya orden se paga | originador |
| 6 | Lugar y fecha de firma | **at signing** |
| 7 | Firma del suscriptor | **at signing** |

Passing reads *"Requisitos cargados — Los campos que dependen del originador
están completos. Los dos restantes se incorporan con la firma del deudor."*

**The blocking failure** is *lugar de pago*, and the prototype now argues it:

> Sin lugar de pago, el art. 102 lo reemplaza por el lugar de creación del
> título. En un pagaré generado electrónicamente ese lugar no surge del
> documento, así que hay que indicarlo de forma expresa.
>
> Indicá una localidad determinada. La jurisprudencia ha rechazado títulos que
> sólo mencionan la provincia.

Presence is therefore not enough: a province-only value must fail.

**Nota de encuadre**, carried in the design itself:

> La firma por medios electrónicos del art. 101 inc. g) está prevista para
> acreedores que sean entidad financiera de la ley 21.526 o para pagarés
> negociados en mercados CNV. Revisá tu encuadre con tu asesoría legal.

**Enviado.** Hand-off by WhatsApp carrying a link of the form
`https://firma.ejemplo.com/f/8H2K9Q`.

## Act 2 — Deudor firma

Three steps on the phone, framed as *"Son tres pasos y lo hacés desde acá."*

1. **Tus datos** — nombre y apellido, DNI, domicilio, entered by the debtor and
   kept: *"La próxima vez ya los vas a tener cargados."*
2. **Lo que vas a firmar** — monto, cuotas, vencimiento, costo total
   (`$2.848.800`), lugar de pago (`San Justo`).
3. **Verificá tu identidad y firmá** — DNI, foto/biometría. Explicitly a
   placeholder: *"Acá el usuario verifica su identidad y firma con nuestro
   proveedor certificado (Lakaut). Es una integración externa, todavía no
   maquetada."*

Ends on `Pagaré firmado.pdf — Firma digital · identidad verificada`, delivered
again over WhatsApp.

## Act 3 — Originador revisa

A list of pagarés filtered `Todos · Enviado · Firmado · Al día · En mora`, over
columns suscriptor / monto / cuotas / estado.

Selecting one **en mora** is where the product argues for itself, by contrast:

| Así lo tenés hoy (paper) | Con el sistema |
| --- | --- |
| Sin lugar de pago ni fecha de suscripción legibles | Pagaré con firma digital |
| Sin verificación de identidad | Identidad verificada · RENAPER |
| Sin cálculo de intereses ni punitorios | Requisitos del art. 101 verificados · 7/7 |
| Documento suelto, difícil de reunir | Cláusula «sin protesto» · art. 50 |
| | Registro de auditoría de la firma · fecha · IP · disp. |
| | Liquidación al día de hoy |

**This is the evidence bundle, specified.** Six items, and a liquidación beside
them: saldo de capital `$1.450.000`, intereses compensatorios (47 d) `$145.634`,
intereses punitorios `$72.817`, total a reclamar `$1.668.451`.

## What changed since 2026-08-16

The previous prototype was vehicle-loan origination at a dealership, issuing a
*pagaré con garantía prendaria* under Res. Gral. 1060/2025.

- **The industry is gone.** No vehículo, no prenda, no concesionaria — 21
  occurrences to zero. `Concesionaria Motos del Oeste` became `Crédito del Oeste
  S.A.`, a lender.
- **The instrument changed.** `PAGARÉ CON GARANTÍA PRENDARIA` → `PAGARÉ A LA
  ORDEN`, plus a *sin protesto* clause.
- **The legal frame changed.** Res. Gral. 1060/2025 → art. 101 del Decreto-Ley
  5965/63, as a seven-item checklist.
- **Two blocking rules became one, plus a checklist.** *Integración de consumo*
  is no longer a validation. *Lugar de pago* survives, argued from art. 102 and
  narrowed to a determinate locality.
- **Identity collection inverted.** The operator no longer types the debtor's
  nombre, DNI, CUIL and domicilio; the debtor enters them and they are verified
  before signing.
- **Only the suscriptor signs.** The old preview drew two blocks, *deudor* and
  *acreedor*.
- **The evidence bundle and a liquidación are specified**, where the old
  prototype only promised a bundle.

## Consequences for the code, not yet acted on

`packages/rules-pagare-ar` was written against the 2026-08-16 prototype and is
now out of step. Rule changes are legal changes (STYLES §10.1) and do not ship
on a test pass, so they are filed rather than made:

1. `PAGARE_AR_KEY.instrumentType` is `pagare-con-garantia-prendaria`, naming an
   instrument the product no longer issues.
2. `integracionDeConsumoRequerida` blocks on a requirement the design dropped.
3. `lugarDePagoRequerido` checks presence, where the design requires a
   determinate locality.
4. The gate branches on `debtor.kind` at origination, where the new flow has no
   debtor data yet — origination and signing are two gates at two moments.
5. The art. 101 checklist has seven items against the policy's three rules.

The *nota de encuadre* above is a question for counsel before any of this is
settled, and it is the concrete instance of the named-reviewer requirement in
STYLES §10.1.
