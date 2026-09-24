# @autopen/signing-demo

Drives the signing spine against Lakaut preproduction, from two pages, in both
journeys. It exists to answer questions preproduction can only answer by being
used — not to be a product. There is no policy gate in front of the seal, no
durable store behind it, and one shared API key in front of the product routes
rather than a key per product.

## Running it

The Hosted UI needs HTTPS and an origin declared in the Lakaut dashboard, so
`http://localhost:3000` will open a session and then be refused at mount. The
server is local; the *browser* has to reach it over the declared origin.

```bash
pnpm build
ngrok http 3000                        # or any HTTPS tunnel
```

Then, before starting the server, point `LAKAUT_ALLOWED_ORIGIN` in `.env` at the
tunnel's origin and declare that same origin in the dashboard under
**Orígenes de la Hosted UI**. Both must match exactly — the Hosted UI reaches
the page by `postMessage`, which takes no wildcard. An undeclared origin fails
closed with `403 FORBIDDEN_ORIGIN`.

```bash
pnpm --filter=@autopen/signing-demo start
```

The `start` script is `node --env-file-if-exists=../../.env dist/server.js`:
the same command on a laptop, where `.env` exists, and in a container, where
it does not and the host injects the variables. The flag needs Node 22.9 or
later (<https://nodejs.org/docs/latest-v22.x/api/cli.html#--env-file-if-existsconfig>);
`.nvmrc` pins the major, so check the minor if the flag is refused.

Open the tunnel URL, not `localhost`. `GET /health` answers without a key —
`{ ok, environment, database }`. `ok: true` means the process is up, nothing
more; `database` is `unconfigured` until `DATABASE_URL` is set and then
whether its host answered a TCP connect, probed at most once every ten
seconds. The server refuses to start when the evidence directory cannot be
written, naming the path.

## The product routes

A product reaches the service with one key, `AUTOPEN_API_KEY`, sent as
`Authorization: Bearer <key>` and compared in constant time. A missing, wrong
or malformed header is a `401` whose body says only `unauthorized`, and the
log line says only `401 <method> <path>` — never the key, never a token, never
a query string. The key is a backend
secret; the issuer's page holds it only because the demo has no product behind
it, and keeps it in `sessionStorage` for the tab.

| Route | Answers |
| --- | --- |
| `POST /api/instruments` | seals the pagaré, mints the link |
| `GET /api/instruments/{id}` | the instrument, with its `state` |
| `GET /api/instruments/{id}/document` | the sealed, unsigned PDF |
| `GET /api/instruments/{id}/artifact` | the signed PDF; `404` until `state` is `signed` |
| `POST /api/eligibility` | the free eligibility read — a probe of a person's status, so behind the key too |

The two pages and the webhook carry their own credentials — the link token,
the HMAC — and take no key.

Two things about tunnels worth knowing before you lose an afternoon to them. An
ephemeral ngrok subdomain changes on every restart, and the declared origin dies
with it — reserve a static domain and declare that once. And the dashboard
versions its configuration on save, so a newly added origin is not instantly live
on every node.

## The two pages

**The issuer's page** (`/`, `web/client.ts`) describes an instrument: the
signer's email and phone, a reference, an amount. `POST /api/instruments`
renders the stand-in pagaré, seals it, and answers with a signing link. The
page shows the link as an anchor and as text to copy; the demo has no way to
send it, so you carry it to the signer yourself. Sending the same reference
with the same bytes again returns the same instrument and the same link; the
same reference with different bytes is refused.

**The signing page** (`/sign/{token}`, `web/sign.ts`) is what the link opens.
It has no form and takes no choices. It makes one call, `POST
/api/sign/{token}/handoff`, and the backend decides the rest:

1. `checkSigningEligibility` for the signer's email, which costs nothing.
2. `signing` over `email` when they already hold a certificate;
   `onboarding-and-signing` over `email-and-sms` when they do not — and that
   journey needs a phone, so an instrument created without one is refused with
   `409` and nothing is opened. A read that recommends no journey at all
   (`CERTIFICATE_PREPARING`, `RETRY_LATER`) is also a `409`, because onboarding
   someone whose certificate is being issued would onboard them twice.
   (`auth.email-sms.v1` requires `EMAIL` **and** `PHONE`; `signing` also
   accepts `sms` and `email-and-sms`, but the demo does not need them.)
3. `openCeremony`, and the handoff is stored against the instrument.

Two link openings at once share one flight per token, and two creates with one
reference share one flight per reference: the provider's `idempotencyKey` is
discarded on the wire (STYLES §9.6), so session and instrument idempotency are
enforced here, before anything is called.

The page mounts the Hosted UI with that handoff. When the ceremony delivers a
signed copy the page posts it to `/api/sign/{token}/deliveries` — under its
own token, and the body must name that instrument's ceremony and document or
it is `409` — the backend verifies it against Lakaut's own record, archives it
under `EVIDENCE_DIR` (the app's own `evidence/` when unset), lets the binding
register, and only then marks the instrument `signed`. If that post fails the
page offers to post the same bytes again and rejects the renderer's callback,
so the Hosted UI emits `signed_document_delivery_failed` and keeps the signer's
download option (`sdk-integracion__documentos-firma.md`, "Falla de entrega");
it never mounts a second ceremony, because the document is already signed at
the provider (STYLES §9.1). A delivery naming a document other than the
ceremony's is refused with `409` here and, independently, by the core with
`DeliveryMismatchError`. `GET
/api/sign/{token}/status` is what the page reads after a lifecycle event:
`signed` means a verified copy is in custody, `awaiting-delivery` means the
session completed and we hold nothing yet, and `cancelled`, `expired` and
`failed` restate the provider's own view with its `errorCode`. A link opened
after its session reached one of those three states gets that state from the
handoff route and no handoff: the page says so and mounts nothing.

Bodies are bounded: a request over the provider's PDF ceiling plus base64 and
JSON overhead is `413` before it is buffered, and a `fileName` over the
vendor's 180 characters is `400`. A `500` carries only `error interno` and the
provider's `correlationId` when the failure had one; the message stays in the
server log, where the ops person is.

Every lifecycle event is a cue to re-read that status, never a conclusion —
`lakaut.flow.completed` means the visual experience ended, not that anything is
signed.

The token is 32 random bytes, base64url, and the only thing in the link.
Nothing logs it: `/sign/{token}` and `/api/sign/{token}/…` are redacted before
a request path is printed, an unknown token gets a `404` and no log line, and
the test suite runs a whole flow with the console captured — objects rendered
the way Node renders them, not as `[object Object]` — to prove the token, the
handoff's client token, the signer's email and phone, and the PDF bytes never
appear (STYLES §8.1). The API key is not among the router's inputs, so that
test says nothing about it; `env.ts` is where it is kept out of reports.

### Headers on `/sign/*`

The signing page, and only it, is served with the two headers
`docs/vendor/lakaut/sdk-integracion__seguridad.md` asks for: a
`Content-Security-Policy` of `frame-src 'self' <hosted-ui-origin>` with
`child-src` kept aligned, and a `Permissions-Policy` allowing camera and
microphone for `self` and that origin — plus `Referrer-Policy: no-referrer`,
ours, because the token is the URL. The origin is `LAKAUT_HOSTED_UI_ORIGIN`,
configured per environment rather than derived from `LAKAUT_ENVIRONMENT` —
the vendor says not to — and every session's `hostedUiOrigin` is checked
against it before its handoff is released, so a stale value fails at the
handoff with both origins named rather than as an iframe the browser refuses
to load. No other CSP directive is set: the vendor recommends only these, and
one it did not ask for cannot be verified without a live ceremony.

The page's layout is bare on purpose: `body { margin: 0 }`, one full-width
container at least 810px tall, no `overflow: hidden`, no CSS transform, nothing
sticky or fixed. The Hosted UI iframe is a fixed 810px and clips otherwise
(`sdk-integracion__frontend-hosted-ui.md`, "Tamaño y responsive").

### Deferred: a stored handoff whose client token has died

A reload of the signing page with a session still `open` — or `completed`
with no copy in custody — gets the stored handoff again, as-is. Its client
token may have expired or been consumed since it was issued, and neither the
reconcile nor the handoff route can tell. The SDK's lifecycle event tells the
page when the handoff is no longer usable, and the page reports that rather
than opening a second session. Recovering a session server-side is a later
change. (A session that is cancelled, expired or failed is not this case: the
handoff route reconciles first and hands nothing off.)

## What it is standing in for

- **The pagaré.** `src/pagare.ts` writes a one-page PDF with no rendering
  library. It is deterministic, which is the only property the spine needs from
  it, and it satisfies none of the instrument's legal requisites. The real
  renderer is `draft`, operation 1 of RESULT-001 §2.2.
- **Custody.** Archiving to a directory. The ordering it demonstrates —
  custody completes, *then* the binding registers — is not a stand-in; it is the
  invariant (STYLES §9.5).
- **Persistence.** In memory. Restarting forgets every ceremony, so a delivery
  arriving after a restart is refused as an unknown ceremony.

## Webhooks

`POST /api/webhooks/lakaut` answers the verification challenge and then verified
events, on the one URL Lakaut allows. It needs no signature quota, which makes
it the part of the flow that can be exercised when signing cannot be — and
`auth.session.failed` carries detail the session read does not: `getSession`
reports `errorCode: null` for a step that failed, and the document status
endpoint answers `404 FORBIDDEN` whether or not the document exists.

Set it up from **Conexión con Lakaut** in the dashboard, which is self-service:

1. Save `https://<tunnel>/api/webhooks/lakaut` as the webhook URL.
2. **Generar secreto** and copy it — shown once, never recoverable.
3. Put it in `.env` as `LAKAUT_WEBHOOK_SECRET` and restart the server.
4. **Verificar destino**, and wait for **Verificado**.

The endpoint fails closed: with no secret configured it answers `503` and
acknowledges nothing, and a delivery that does not verify gets `401` rather than
a `500`, so a rejected delivery is distinguishable from a broken handler.

Verify the responder before pointing Lakaut at it — a failed challenge means
generating a new secret, since the pending one cannot be recovered.

## Deploying

The root `Dockerfile` builds the demo the way CI does — corepack, the pnpm in
`packageManager`, `.npmrc.example` copied into place — in three stages, so the
Nexus credential is read by `pnpm install` in stages the runtime image only
copies from, and reaches no image layer. It arrives as the build argument
`LAKAUT_NPM_AUTH`. Railway has no build-only class of variable: it fills
Dockerfile `ARG`s from the service's variables and injects those same
variables into the running container, so on Railway `LAKAUT_NPM_AUTH` will
also be present in the runtime environment. `env.ts` ignores it; nothing at
runtime reads it. The runtime image runs as `node`, listens on `PORT`, owns a
default `evidence/` so it boots without a volume, and starts with the demo's
`start` command in exec form so `node` is PID 1 and handles `SIGTERM`.

Service variables, all read by `src/env.ts` and described in `.env.example`:

- `LAKAUT_AUTH_BASE_URL`, `LAKAUT_INTEGRATOR_ID`, `LAKAUT_API_KEY`,
  `LAKAUT_ENVIRONMENT` — the sandbox credentials, per environment.
- `LAKAUT_ALLOWED_ORIGIN` — the service's own `https://` domain, exactly.
- `LAKAUT_HOSTED_UI_ORIGIN` — the Hosted UI's origin, as given at onboarding.
- `LAKAUT_WEBHOOK_SECRET` — from the dashboard, once the webhook URL is saved.
- `AUTOPEN_API_KEY` — `openssl rand -base64 32`; the product's key.
- `EVIDENCE_DIR` — a path on a mounted volume, e.g. `/data/evidence`. The
  server must be able to write there as the `node` user.
- `PORT` — Railway injects it. `DATABASE_URL` — optional; `/health` only.

Two dashboard entries, both under the integration, both per environment: the
service's domain under **Orígenes de la Hosted UI** (already declared for the
tunnel — replace it with the deployed one), and
`https://<domain>/api/webhooks/lakaut` as the webhook URL, then **Generar
secreto** → `LAKAUT_WEBHOOK_SECRET` → redeploy → **Verificar destino**.

## Preproduction is not a scratch environment

The signing PIN is per signature with no documented reset, and
`SIGN_PIN_RATE_LIMITED` is a real code. Opening sessions is cheap; locking an
identity is not. Run `signing` against an identity that already holds a
certificate before running `onboarding-and-signing` against one that does not.

An account is one per **email**, so any mailbox you control is a new test
signer. The identity step is live, though — a real face, three attempts — so a
new signer is a new address for a consenting person, not a synthetic one
(AGENTS.md, "Vendor access").
