# Building a product on autopen

For someone writing a product that needs a document signed with a qualified
signature and the proof kept. You do not need to read the research, the vendor
mirror or STYLES to build on the core; you need this page, `packages/gate/README.md`
and `apps/signing-demo/` as the worked example.

## The split

| You own | The core owns |
| --- | --- |
| Your document, rendered as a PDF | Sealing it: a permanent identity for exactly those bytes |
| Your rules for when it may be sent | Running them, and refusing when none are configured |
| Who signs, and how you reach them | The ceremony with the certifying authority, including onboarding a first-time signer |
| Your pages | The signing surface inside your page |
| Where the signed file is stored | Verifying the file against the authority's record, and refusing to bind one that was not stored |

Nothing about the pagaré lives in the core. `packages/rules-pagare-ar` and
`docs/product/` are one product's; your product gets its own.

## The calls, in order

Five calls on the backend, one in the browser. Names are the real exports.

```ts
import { DefaultSigningCore, InMemoryCeremonyLedger, InMemoryDocumentStore } from "@autopen/core";
import { checkSigningEligibility, createLakautProvider, LAKAUT_MAX_DOCUMENT_BYTES } from "@autopen/adapter-lakaut";

const lakaut = { baseUrl, integratorId, apiKey, environment, allowedOrigin, now: () => new Date() };

const core = new DefaultSigningCore({
  provider: createLakautProvider(lakaut),
  documents: new InMemoryDocumentStore(),   // replace with yours; see "Stores"
  ceremonies: new InMemoryCeremonyLedger(), // same
  now: () => new Date(),
  maxDocumentBytes: LAKAUT_MAX_DOCUMENT_BYTES,
});
```

**1. Ask whether the signer already has a certificate.** Free — no session, no
PIN, nothing consumed. It tells you which journey to open.

```ts
const eligibility = await checkSigningEligibility(lakaut, { email, externalUserRef });
// eligibility.journey is "signing" | "onboarding-and-signing" | undefined
```

**2. Seal the PDF.** `reference` is your own identifier for the instrument;
namespace it with your product (`lease/2026-0042`) because it becomes part of
the document's identity.

```ts
const sealed = await core.seal(pdfBytes, reference);
// sealed.documentId is derived from reference + content hash: same bytes, same id, forever
```

**3. Open a ceremony** for one signer over that document. The plan says which
journey and which factors; onboarding requires `email-and-sms`, so it needs a
phone.

```ts
const ceremony = await core.openCeremony(
  sealed.documentId,
  { role: "signer", email, phone, externalUserRef },
  { journey: eligibility.journey ?? "signing", factors: "email" },
);
// send ceremony.handoff + the sealed document to your page. Never log the handoff.
```

**4. In the browser, mount the signing surface** where your page wants it. It
is an iframe from the certifying authority; your page provides the container
and nothing else.

```ts
import { mountCeremony } from "@autopen/adapter-lakaut/browser";

mountCeremony({
  handoff, container, document: sealed, fileName, language: "es",
  onEvent: (event) => { /* update your UI. Proves nothing. */ },
  onSigned: async (delivery) => { await fetch("/api/deliveries", { method: "POST", body: encode(delivery) }); },
});
```

**5. Ingest the delivered copy**, handing the core the function that stores it.
The core verifies the copy against the authority's record, calls your function,
and only if it resolves registers the binding. This is the moment custody is
established.

```ts
const verified = await core.ingest(delivery, async (artifact) => {
  await yourStorage.put(artifact.documentId, artifact.bytes); // must be durable before returning
});
// verified.signatures[0].certificateRef, verified.signedContentHash, verified.finalPdfHash
```

**6. Reconcile** whenever you need the authority's own view of the ceremony —
after a browser event, on a timer, on a webhook.

```ts
const status = await core.reconcile(ceremony.ceremonyId); // state: open | completed | cancelled | expired | failed
```

That is the whole surface. `apps/signing-demo/src/server.ts` is these six calls
behind HTTP routes; `web/client.ts` is step 4.

## Things that are true whether or not you like them

**The browser proves nothing.** `lakaut.flow.completed` means the visual
experience ended. A signature exists when `ingest` returns, and not before. Do
not mark anything signed, send anything, or show a receipt on a browser event.

**A session staying `open` after a signature is normal.** The document being
signed and the session being closed are separate facts; the signature is
established by the artefact verification, not by session state.

**Your storage function is called before the binding, on purpose.** If it
throws, nothing is bound and `ingest` fails. Store first, return second. Do not
"store later".

**A reference is permanent.** Sealing different bytes under the same
`reference` yields a different `documentId`, never a conflict; but a corrected
document is a new instrument, not an edit. There is no unseal.

**`externalUserRef` binds to the first email it is seen with.** Reusing it with
another email fails with a bare `400 INVALID_REQUEST`. Make it per person, not
per document, and never reuse one across signers.

**Never log:** the API key, the handoff (it carries a single-use token), OTPs,
DNI, sexo, PIN, PDF bytes, biometric evidence, JWTs. Log `sessionId`,
`documentId`, `correlationId`, `errorCode` and timestamps — those are what
vendor support can trace.

**A signer's PIN has no reset.** The first time someone signs they set a PIN;
every signature after that asks for it, and a lockout may not be recoverable.
Your UI should say so before the PIN screen.

## What every product shares, and what that costs

There is one integration with the certifying authority, and every product on
the core sits behind it:

- **One webhook URL.** Events for every product arrive at one endpoint, routed
  by `sessionId`. A relay that verifies and forwards to the owning product is
  planned; until it exists, only one deployment can receive webhooks. `reconcile`
  is the substitute and is always available.
- **One dashboard of origins.** Every page that mounts a ceremony runs on an
  origin declared there, exactly — no wildcard. Adding a product is adding its
  origin.
- **One API key.** A product wired directly to the core holds it. Treat that as
  a backend secret in the strict sense: never in a bundle, a response or a log.
- **One signature balance.** Every product draws from the same allocation, and
  no API reads it.

## Stores

`DocumentStore` and `CeremonyLedger` are interfaces; the in-memory ones forget
everything on restart, which is fine for a demo and wrong for a product. Keep
the `sessionId ↔ documentId ↔ your instrument` mapping forever — it is the only
route back to the authority's receipt — and keep `correlationId` with it.

## Not built yet

- **The evidence bundle** (`assemble`): a manifest of what you hold, with
  provenance per item. Today you get `VerifiedArtifact` and keep it yourself.
- **Durable stores.** You bring your own implementations of the two interfaces.
- **The webhook relay**, above.
- **Publishing.** The packages are workspace-private today: a product either
  lives under `apps/` in this repository or waits for the packages to be
  published. That is a decision still to be made, and it decides whether a
  product can live in its own repository with its own rules.

## The rules you inherit if your product lives here

Anything under `apps/` in this repository is subject to `STYLES.md` and the
checks in `pnpm verify`. That is deliberate for the core and heavy for a
product. If that is not the way you want to work, the answer is a separate
repository against published packages — see "Not built yet".
