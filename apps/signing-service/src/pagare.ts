/**
 * A minimal, deterministic pagaré PDF, built without a rendering library.
 *
 * A stand-in, not the instrument: the real renderer belongs to `draft`
 * (RESULT-001 §2.2, operation 1). Byte-identical for identical inputs — no
 * clock reaches these bytes, the object order is fixed, and the cross-reference
 * offsets are measured from the output rather than assumed (STYLES §7.2).
 */

const ENCODER = new TextEncoder();

/** The handful of fields the stand-in PDF prints. Not the rule set's `PagareDraft`. */
export interface PagareDraft {
  /** The caller's own instrument identifier, printed and used as the seal reference. */
  readonly reference: string;
  /** Integer centavos, never a float (STYLES §7.1). */
  readonly montoCentavos: number;
  readonly librador: string;
  readonly lugarDePago: string;
  /** ISO date. Supplied rather than read from a clock, so the bytes stay stable. */
  readonly vencimiento: string;
}

/** `190000000` centavos as `$1.900.000,00`, in the es-AR convention. */
function formatPesos(centavos: number): string {
  const pesos = Math.trunc(centavos / 100);
  const resto = String(Math.abs(centavos % 100)).padStart(2, "0");
  const grouped = String(pesos).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `$${grouped},${resto}`;
}

/** Escapes the three characters that terminate or nest a PDF literal string. */
function literal(text: string): string {
  return text.replace(/[\\()]/g, (character) => `\\${character}`);
}

function contentStream(draft: PagareDraft): string {
  const lines: readonly [number, string][] = [
    [780, "PAGARE A LA ORDEN"],
    [745, `Por ${formatPesos(draft.montoCentavos)}`],
    [720, `Pagadero en ${draft.lugarDePago}`],
    [695, `Vencimiento: ${draft.vencimiento}`],
    [670, `Librador: ${draft.librador}`],
    [645, `Referencia: ${draft.reference}`],
    [600, "BORRADOR DE DEMOSTRACION - SIN VALOR LEGAL"],
  ];

  const drawn = lines
    .map(([y, text]) => `BT /F1 ${y === 780 ? 18 : 12} Tf 60 ${y} Td (${literal(text)}) Tj ET`)
    .join("\n");

  return `${drawn}\n60 630 m 535 630 l S\n`;
}

/**
 * Assembles the file, measuring each object's byte offset as it goes.
 *
 * The cross-reference table states where every object starts, so the objects
 * are serialised first and the table written from what was actually emitted.
 */
export function renderPagare(draft: PagareDraft): Uint8Array {
  const stream = contentStream(draft);

  const objects: readonly string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${ENCODER.encode(stream).length} >>\nstream\n${stream}endstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(ENCODER.encode(body).length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const startxref = ENCODER.encode(body).length;
  const entries = offsets
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");

  const trailer =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${startxref}\n%%EOF\n`;

  return ENCODER.encode(body + trailer);
}
