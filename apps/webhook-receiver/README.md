# @autopen/webhook-receiver

Answers Lakaut's webhook destination challenge, and nothing else yet.

## Why it exists before anything else

A webhook destination is only active once it has answered a signed challenge,
and the secret is issued against a saved URL — so the endpoint has to exist
before the credential does (`docs/vendor/lakaut/sdk-integracion__configurar-webhook.md`,
§"Alta inicial"). Until then the destination is *No configurado* and Lakaut
attempts no delivery at all.

That makes this the one piece of the integration that ships first. The challenge
is a self-contained HMAC exchange: it needs no session, no certificate, no DNI
and no PIN, so it can be exercised against preproduction without touching any of
the resources that are scarce or unrepeatable (AGENTS.md, "Vendor access").

## What it deliberately does not do

It does not handle business events. A challenge and an event are signed
differently — `${timestamp}.${rawBody}` under `Lakaut-Webhook-Signature` versus
`${timestamp}.${eventId}.${rawBody}` under `Lakaut-Signature` — and an event
must be verified by the SDK's `constructWebhookEvent`, never by hand
(STYLES §9.1). Only the challenge is implemented here, and only because the
vendor documents the construction and answers it with `node:crypto` itself.

A delivery that is not a challenge gets **503**, not 200. A 2xx is an
acknowledgement: answering an event before the SDK lane exists would tell Lakaut
it was handled and let it fall on the floor. Refusing keeps it queued.

No third-party dependencies, and no framework in particular. The HMAC covers the
bytes as received, so a body-parsing middleware is the classic way to break it;
reading the stream directly makes that hard to do by accident.

## Running it

Needs `LAKAUT_WEBHOOK_SECRET`, which means a URL must already be saved in the
dashboard. Optional: `PORT` (3000), `LAKAUT_WEBHOOK_PATH` (`/webhooks/lakaut`).

```bash
pnpm --filter=@autopen/webhook-receiver build
pnpm --filter=@autopen/webhook-receiver start
```

`start` loads the repo-root `.env` through Node's own `--env-file`; there is no
`dotenv` dependency and should not be one.

## Pointing Lakaut at a laptop

The destination must be `https://` on port 443 and resolve only to globally
routable addresses. Loopback, private ranges and CGNAT are rejected and
re-checked on connect, so `localhost` will never work and a tunnel is the only
development path.

Prefer a stable hostname over an ephemeral one. The verified pair is URL *and*
secret, so a tunnel that hands out a new hostname each restart means
re-verifying every time — a named tunnel on a subdomain under our own domain
avoids that. The webhook URL is unrelated to `LAKAUT_ALLOWED_ORIGIN`, which
governs browser origins for the Hosted UI; it does not need to be declared
there.

Order of operations, once a hostname is fixed: save the URL, generate the
secret, put it in `.env`, start this app, then *Verificar destino* and wait for
**Verificado**.
