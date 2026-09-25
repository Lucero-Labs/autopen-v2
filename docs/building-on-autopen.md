# Building on autopen

You have a PDF and someone who must sign it with a qualified digital
signature. You call one HTTP service, hand the signer a link, and collect the
signed file. You never talk to the certifying authority, hold its credentials,
or install its SDK.

## The service

- Staging: `https://autopen-v2-staging.up.railway.app`
- Every product route needs `Authorization: Bearer <AUTOPEN_API_KEY>`. The key
  is a backend secret: use it from server code only, never from a browser, a
  URL or a log. A wrong or missing key is `401 { "error": "unauthorized" }`.
- Bodies and responses are JSON. Files travel as base64.

## Create an instrument

```
POST /api/instruments
{
  "reference": "lease/2026-0042",
  "fileName": "contrato.pdf",
  "pdfBase64": "<the PDF, base64>",
  "signer": { "email": "firmante@example.com", "phone": "+5491100000000" }
}
→ 201 { "instrumentId": "…", "reference": "…", "documentId": "…",
        "state": "awaiting-signature", "signingUrl": "https://…/sign/…" }
```

`reference` is your own id for the document; a UUID from your database is
fine. `phone` is needed when the signer has never signed with the authority
before, so send it. The PDF must be a real PDF and at most 20 MB.

An instrument's identity is its reference, its bytes and its signer:

- same reference, same PDF, same signer → `200` and the same instrument;
- same reference, different PDF or different signer → `409`. A corrected
  document is a new reference, never an edit;
- bad base64, not a PDF, bad `fileName` → `400`; too large → `413`.

## Send the link

`signingUrl` opens a page on the service's own domain where the signer
verifies their identity and signs. Send it however you like; the service sends
nothing. Show it as a link, do not embed it in an iframe. Whoever holds the
link can open the page, so treat it like a password reset link.

## Know when it is signed

```
GET /api/instruments/{instrumentId}   → { …, "state": "awaiting-signature" | "signed" }
GET /api/instruments/{instrumentId}/artifact   → the signed PDF (404 until signed)
GET /api/instruments/{instrumentId}/document   → the unsigned PDF you sent
```

Poll the instrument, on page load or every 30 seconds while something is
awaiting. `signed` means the service holds a copy verified against the
authority's record; nothing the signer's browser says can set it. There is no
webhook to you yet.

## What the service does not do

- Decide whether a document should be signed. Your rules run before you call.
- Render documents. You send a finished PDF.
- Keep the signed file for you forever. Fetch the artefact and store it.
- Notify you. Poll.

Every product draws on one signing balance at the authority. A per-product
budget is planned, not built.
