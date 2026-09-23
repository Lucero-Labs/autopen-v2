# @autopen/signing-demo

Drives the signing spine against Lakaut preproduction, from a page, in both
journeys. It exists to answer questions preproduction can only answer by being
used — not to be a product. There is no policy gate in front of the seal, no
durable store behind it, no webhook ingress and no authentication of the caller.

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

Open the tunnel URL, not `localhost`.

Two things about tunnels worth knowing before you lose an afternoon to them. An
ephemeral ngrok subdomain changes on every restart, and the declared origin dies
with it — reserve a static domain and declare that once. And the dashboard
versions its configuration on save, so a newly added origin is not instantly live
on every node.

## What the page does

Pick a journey and the factors, and it opens a ceremony with that plan. The two
are not interchangeable:

| Journey | Factors the catalogue allows | Who it is for |
| --- | --- | --- |
| `signing` | `email`, `sms`, `email-and-sms` | A signer who already holds a certificate |
| `onboarding-and-signing` | `email-and-sms` only | A signer who does not, so it issues one |

`auth.email-sms.v1` requires `EMAIL` **and** `PHONE`, which is why onboarding
asks for a phone and signing does not.

Then, in order: the backend renders a pagaré, seals it, opens the ceremony, and
returns the renderer handoff. The page mounts the Hosted UI. When the ceremony
delivers a signed copy the page posts it back, the backend verifies it against
Lakaut's own record, archives it under `evidence/`, and only then lets the
binding register. Every lifecycle event is a cue to re-read the authoritative
status, never a conclusion — `lakaut.flow.completed` means the visual experience
ended, not that anything is signed (STYLES §9.1).

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

## Preproduction is not a scratch environment

The signing PIN is per signature with no documented reset, and
`SIGN_PIN_RATE_LIMITED` is a real code. Opening sessions is cheap; locking an
identity is not. Run `signing` against an identity that already holds a
certificate before running `onboarding-and-signing` against one that does not.

An account is one per **email**, so any mailbox you control is a new test
signer. The identity step is live, though — a real face, three attempts — so a
new signer is a new address for a consenting person, not a synthetic one
(AGENTS.md, "Vendor access").
