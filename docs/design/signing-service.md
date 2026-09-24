# The signing service

Run the core once, as a web service, with the signing page on our own domain.
Products call the service; they never talk to Lakaut.

## 1 · Why

Lakaut gives us one API key, one webhook URL, one list of allowed browser
domains, and an SDK on a private registry. Anything that talks to Lakaut
directly has to hold all four. We want the pagaré product and, later, other
products to sign documents without holding any of them.

So: one service owns the Lakaut integration. A product sends it a PDF and a
signer, gets back a link, sends the link to the signer, and asks the service
later whether it was signed.

## 2 · How it works

**Creating an instrument.** `POST /v1/instruments` with the PDF, the product's
own reference, and the signer's email and phone. The service seals the PDF and
returns an id and a signing link. Sending the same reference and the same
bytes twice returns the same instrument.

**The signing link.** The link points at a page on our domain. When the signer
opens it, the service asks Lakaut whether that person already has a
certificate, opens the right kind of session, and shows Lakaut's signing UI on
our page. The product never sees any of this.

**The signed PDF.** Lakaut never sends us the file. The only copy comes from
the signer's browser, through our page, which posts it to the service. The
service checks the copy against Lakaut's record, saves it, and only then
registers it as signed. So the service has the file before anyone asks.

**Knowing it is signed.** The product polls `GET /v1/instruments/{id}`. It says
`signed` only once the file is saved and verified. Then
`GET /v1/instruments/{id}/artifact` returns the signed PDF.

**Lakaut's webhook.** It arrives at the service, is verified, stored, and
matched to an instrument by session id. It is a receipt, not the file. A
webhook for a session we do not know is stored and flagged, never dropped.

**Rules.** The service does not check whether a document should be signed.
Each product applies its own rules before calling. The pagaré product runs
`rules-pagare-ar` in its own process.

## 3 · Products and keys

Each product gets an API key from us. It is a backend secret: a product that
uses it from a browser has leaked it. Lakaut's own key never leaves the service.

Each product also gets a **signature budget**. All products spend Lakaut's one
balance, which no API can read and which, when empty, fails the signer with
something that looks like a wrong PIN. The service counts each product's
signatures down and refuses to open a session at zero, before Lakaut is
involved.

How a product logs in its own users is the product's business.

## 4 · Where it runs

Railway, with Postgres. Two deployments: staging with Lakaut's sandbox
credentials, production with production ones. Lakaut allows one webhook URL
per environment, so that is exactly one per deployment. A fixed URL also
retires the ngrok tunnel.

Signed PDFs are stored in Postgres, in the same transaction that records the
signature, so a document is never marked signed without its file.

## 5 · What fails, and how

| Situation | Result |
| --- | --- |
| Bad or missing API key | `401` |
| Another product's instrument | `404`, same as a missing one |
| Budget at zero | `409`, Lakaut not called |
| Saving the file fails | Nothing marked signed; the page asks the signer to retry |
| The signer's browser never delivers the file | The document is signed at Lakaut, we hold nothing. The page waits for our save before showing success, and a copy the signer downloaded themselves can be posted later and verifies the same way |
| Webhook for an unknown session | Stored and flagged |
| Link for a finished or cancelled instrument | The page says so, nothing is opened |
| Webhook secret not set | Webhook route answers `503` |
| Database down at start | Process exits |

## 6 · Testing

Routes are tested with a fake provider; nothing calls Lakaut in CI. The
Postgres stores are tested against a real database in CI. One test runs a
whole flow with logs captured and checks that the API key, the link token, the
PDF bytes and the signer's email never appear in them.

## 7 · Not now

- Rendering PDFs, and the evidence bundle. Products send finished PDFs.
- More than one signer per instrument.
- A webhook from us to products. Lakaut's inbound webhook does not work yet,
  so polling is the only path that can be trusted today.
- Embedding our page inside a product's page.
- Self-service for keys and budgets. One product is configured by hand.
- Production Lakaut credentials, still pending on their side.

## 8 · Open questions

For Lakaut: may one integration sign for a product we do not operate; is the
balance shared per integration in production; what does a production signature
cost; when do production credentials arrive.

For us: what the second product signs, who signs it, and roughly how many a
month. Until that is written down, it gets a key against staging and a budget.
