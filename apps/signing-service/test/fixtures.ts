/**
 * What the route tests post: a PDF built by hand, and the create body around it.
 *
 * No binary fixture files. The PDF is the smallest valid one — one page, one
 * text object — and byte-identical for the same text, so two requests with
 * the same fixture seal the same document and two with different text do not.
 */

const ENCODER = new TextEncoder();

/** A fake signer; any real address in a fixture would end up in a never-log assertion. */
export const SIGNER_EMAIL = "firmante@example.invalid";
export const SIGNER_PHONE = "+5491100000000";

/** Text drawn into the fixture PDF, so a test can prove the bytes reached no log line. */
export const PDF_SENTINEL = "PDF-BYTES-NEVER-LOGGED-7f3a";

/** Escapes the three characters that terminate or nest a PDF literal string. */
function literal(text: string): string {
  return text.replace(/[\\()]/g, (character) => `\\${character}`);
}

/**
 * A one-page PDF drawing `text`, with a cross-reference table measured from
 * the bytes actually emitted rather than assumed.
 */
export function minimalPdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 60 780 Td (${literal(text)}) Tj ET\n`;
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
  const entries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`);
  const trailer =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join("")}` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;

  return ENCODER.encode(body + trailer);
}

/** The body `POST /api/instruments` takes, complete, with `overrides` laid over it. */
export function fixtureRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reference: "harness/test-1",
    fileName: "test-1.pdf",
    pdfBase64: Buffer.from(minimalPdf(PDF_SENTINEL)).toString("base64"),
    signer: { email: SIGNER_EMAIL, phone: SIGNER_PHONE },
    ...overrides,
  };
}
