# Preproduction recon: what the vendor's own edge says about them

**Dated 2026-09-16.** Findings from a read-only examination of Lakaut's
preproduction infrastructure, run with the integration's own access while the
vendor's infrastructure migration (ADDENDUM-quota §4) is underway. Recorded for
the same reason as the quota addendum: several observations below contradict or
sharpen assumptions an integrator would otherwise take from the documentation,
and one of them bears on how much of our own verification we can ever delegate.

## Method and limits

Everything here was passive or minimally active: DNS, TLS handshakes, HTTP
headers, unauthenticated requests, port-connect checks against 27 common ports,
and this repo's two vetted probe scripts (`scripts/probe-catalog.mjs`,
`scripts/probe-registry.mjs`). **No session was created, no identity was
touched, no PIN-bearing operation was run, no quota was spent, and no endpoint
was fuzzed.** Rate limiting was deliberately not tested — preproduction is not
a scratch environment (AGENTS.md), and measuring it means hammering the one
integration we have.

## 1 · One machine fronts everything

All four vhosts resolve to a single IP:

| Host | A record |
| --- | --- |
| `auth-preprod.lakautac.com.ar` | `201.216.192.135` |
| `web-preprod.lakautac.com.ar` | `201.216.192.135` |
| `sdk-preprod.lakautac.com.ar` | `201.216.192.135` |
| `packages-preprod.lakautac.com.ar` | `201.216.192.135` |

The address sits in a /28 registered at LACNIC to an individual, country AR. No
AAAA records. Auth API, dashboard, Hosted UI and the npm registry share one
edge — a single point of failure for a certifying authority, and the kind of
topology an infrastructure migration would plausibly exist to fix.

**Ports: 80 and 443 only.** Of the 27 common ports checked (SSH, databases,
Redis, Elasticsearch, Docker, alternate HTTP), nothing else answers. Port 80
issues a plain 301 to HTTPS on all four vhosts.

**Edge stack:** openresty (version not disclosed), HTTP/2, TLS 1.3 preferred
with 1.2 accepted, Let's Encrypt 90-day certificates with per-host SANs, HSTS
`max-age=63072000; preload` on every vhost. TLS 1.0/1.1 acceptance could not be
tested — the client (OpenSSL 3.6.2) refuses to offer them.

## 2 · The auth API sits behind a default-deny proxy

Unknown paths (`/health`, `/metrics`, `/openapi.json`, `/robots.txt`,
`/.well-known/openid-configuration`) are refused at the proxy with an empty
`403` — they never reach the application. Allowlisted routes pass through to
real authentication:

| Request | Result |
| --- | --- |
| `GET /v1/sdk/catalog`, no credentials | `401 {"code":"UNAUTHORIZED"}` |
| `POST /v1/sdk/signing-eligibility`, valid body, no credentials | `400 INVALID_REQUEST` |
| Same, fake `X-Integrator-Id`, no API key | `401 UNAUTHORIZED` |
| `OPTIONS` preflight from a hostile origin | `401`, zero `Access-Control-*` headers |

Auth is enforced on everything probed; there is no unauthenticated eligibility
oracle. The quirk is taxonomic: a request with no credentials at all is
reported as `400 INVALID_REQUEST` rather than `401`, so "missing headers" and
"malformed body" are indistinguishable. Consistent with the vendor's documented
taste for opaque errors — and with its cost (ADDENDUM-quota §7).

One seam is visible: `/actuator/health` returns openresty's default 404 page
while every other unknown path returns the empty 403. The proxy ruleset is
hand-maintained, and it shows.

## 3 · The registry has not moved

`probe-registry.mjs`, 2026-09-16, identical to 2026-09-11: `@preprod` →
`0.1.0-rc.34`, `@dev` → `0.1.0-rc.53`, `0.1.0-rc.40` published and untagged, on
all three packages. Whatever the migration is doing, it is not touching the
release channels. The exact-version pin remains the only thing keeping the
mirror's citations valid.

Nexus exposes only `/repository/*`; its REST API (`/service/rest/v1/status`,
which typically discloses the product version unauthenticated) is not mounted,
and anonymous read is disabled (`401`). No version disclosure anywhere.

## 4 · The credentialed probes

`probe-catalog.mjs`: the API key works, and the catalogue matches the
contracted scope exactly — onboarding journeys only with `auth.email-sms.v1`,
signing with all three profiles. Both rc.40-only endpoints answer `400` to an
empty body (present, not `404`). The catalogue also confirms the documented
default-profile trap: `journey.signing.v1` defaults to `auth.email.v1`, and
`auth.sms.v1` is the only profile with `requiresServerBoundIdentity: true`.

## 5 · The dashboard

`web-preprod` is a Next.js application. What an unauthenticated visitor can
learn:

**`/api/health` is public and operational:**
`{"status":"ok","timestamp":"…","uptime":18345,"env":"production"}`. Uptime is
a deploy signal — it resets on every release, and at probe time the preprod app
had been up ~5 hours while `www.lakautac.com.ar` reported ~6.2 days. Something
deployed to preproduction the same day, mid-migration.

A correction to the first reading of `env:"production"` is owed:
`www.lakautac.com.ar/api/health` reports the same value, so this is almost
certainly `NODE_ENV` — `"production"` for any `next build`, including preprod
deploys. It is not evidence that preproduction is cross-wired to production
systems. It is evidence that their own telemetry cannot distinguish
environments — the one question a health endpoint exists to answer during a
migration.

**The API layer is tRPC, and its errors are verbose.** Any
`/api/trpc/<path>` returns a structured envelope naming `code`, `httpStatus`,
`path`, and carrying `zodError`, `userMessage` and `backendError` fields. A
`NOT_FOUND` for a nonexistent procedure is distinguishable from the
`UNAUTHORIZED` a protected one would return, so the procedure space is
enumerable without credentials. Procedure names were not fuzzed; the surface is
confirmed, the enumeration is possible.

**The shipped bundles carry development residue:**
`http://localhost:3000/api/auth` appears in a production-served chunk, and the
full OpenReplay session-replay tracker is bundled with self-hosted ingest
points (`web-preprod.lakautac.com.ar/collect`, `dev.lakautac.com.ar/ingest`).
Session replay on a dashboard whose purpose includes displaying API keys and
webhook secrets in shown-exactly-once dialogs is a bad combination by
construction. Whether recording is active on those screens, and whether the
secret dialogs are masked, is not determinable from outside; the tracker code
ships to every visitor regardless.

**`dev.lakautac.com.ar` answers `503` with `retry-after: 300`**, on separate
infrastructure (two A records, shared with the www marketing site). A
deliberate maintenance window, plausibly the migration itself.

**Credit where due:** protected routes redirect server-side (`307`, no content
leak), no source maps are exposed, no `NEXT_PUBLIC_` secrets appear in the
bundles, and the registry is locked down. The edge hygiene is decent. The
defects concentrate in application logic and process, not in infrastructure
configuration.

## 6 · What the pattern is worth

No single finding above is an exploit. Their value is as a sample of the
vendor's visible work, used to price the error rate of the invisible work — the
webhook verifier, the rotation logic, the quota checks that no integrator can
see. The sample says the defect rate concentrates in exactly the areas that
matter to us:

- **Verification theater.** A control that exists as UI but not as an
  operation is worse than an absent control, because everyone downstream
  trusts it. (Reported by the integrator: a public verification page that does
  not verify the vendor's own signatures — not located during this pass; see
  §8.) For a signature provider, verification *is* the product. This is why
  the adapter verifies every artefact against the authority record
  server-to-server (STYLES §9.5) and treats anything a page or browser says as
  a claim to be checked.
- **Errors as afterthought.** The contract fails in both directions: too
  opaque where integrators diagnose (a reused `externalUserRef` names nothing;
  `404 FORBIDDEN` covers unknown session and unknown document alike;
  `document_sign_failed` ships in the wild while absent from the SDK's own
  error union — ADDENDUM-quota §5), too verbose where attackers listen
  (`zodError`/`backendError` in tRPC envelopes). Both extremes come from the
  error contract never having been designed. Opaque errors push integrators
  into dangerous workarounds — retrying terminal failures, reading "no error"
  as "success"; verbose errors hand attackers a map.
- **Documentation drifts from behavior, silently.** Veriff vs FID; an
  `idempotencyKey` that compiles, validates and is silently discarded; a
  lifecycle code the docs say cannot arrive. Each instance is small; the
  pattern means documented behavior is a hypothesis, not a specification. This
  repo's answer — a pinned mirror, drift recorded on re-fetch, probe scripts
  that assert rather than assume — is the correct posture and should not
  relax.
- **Environment confusion.** A stale `@preprod` tag, a health endpoint that
  cannot name its environment, localhost URLs in shipped bundles. The
  mechanism is copy-pasted configuration plus nothing that fails loudly on a
  mismatch; the end state of that road is credentials valid across
  environments. Our per-environment credentials, validated at boot and never
  copied, are the defense (STYLES §8).
- **Third-party defaults on sensitive surfaces.** Session replay is present
  because analytics is a checkbox and masking is opt-in. Nobody threat-modeled
  what the tracker sees on the screen where the webhook secret is shown once.

## 7 · Consequences for this repo

Nothing here changes the architecture; it confirms it. Verify against the
authority record, never the browser (STYLES §9.1). Deduplicate webhooks
ourselves. Timestamp and capture revocation state at ingest, because the vendor
offers no LTV material (RESULT-001-ADDENDUM §2). Accept both `auth.document.signed`
contracts during the migration (§4 of the same). Keep the SDK pinned exact.

Worth raising with Lakaut alongside the quota questions (ADDENDUM-quota §10):

14. `/api/health` discloses uptime and a misleading `env` on every host.
15. tRPC error envelopes carry `zodError`/`backendError` and make the
    procedure space enumerable unauthenticated.
16. Is the OpenReplay tracker active on dashboard screens that display
    credentials, and are those dialogs masked?
17. The `@preprod` channel still installs rc.34 against an rc.40 service.

## 8 · Open

- The public signature-verification page reported by the integrator was not
  found on preproduction or www routes (`/verificar`, `/verificacion`,
  `/validar`, `/verify` all 404; `/firma` requires login). Where it lives
  determines whether "does not verify" is a marketing-site bug or a
  verification-path bug. Only the second is systemic.
- Whether OpenReplay records authenticated dashboard sessions.
- Rate limiting on `signing-eligibility` and session creation — untested by
  policy, worth a vendor answer rather than an experiment.
