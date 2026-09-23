# Signature quota: what preproduction taught us on 2026-09-12

Findings from the first end-to-end ceremony attempts against preproduction,
integration `lucerosa`, environment `sandbox`. Recorded here because two of them
contradict assumptions in RESULT-001 and one of them blocks the verification
list in §6.

## 1 · A ceremony can fail for a reason no API exposes

Two `SIGNING` ceremonies were opened for an identity that holds a valid
certificate. Both reached the signing-key step and then ended in
`lakaut.flow.failed`. Afterwards:

| Read | Answer |
| --- | --- |
| `getSession(sessionId)` | `status: open`, **`errorCode: null`** |
| `GET .../documents/{id}/status` | `404 FORBIDDEN` |
| `getSigningEligibility` | `READY_FOR_SIGNING`, `nextAction: CREATE_SESSION` |

Nothing on the server side names the failure. The document status endpoint
answers `404 FORBIDDEN` identically for an unknown session and an unknown
document — already known (`signing-spine.md` §2.1) — so it cannot even confirm
the document was reached.

That leaves two channels: the browser lifecycle event, and the webhook. Both are
now surfaced (`CeremonyEvent.errorCode`, `readCeremonyNotification`).

## 2 · `getSigningEligibility` does not account for quota

The eligibility probe was run **after** the account's signature balance reached
zero and still returned:

```
decision:             READY_FOR_SIGNING
recommendedJourneyId: SIGNING
nextAction:           CREATE_SESSION
retryAfterSeconds:    null
```

So it answers *"does this person hold a valid certificate"*, not *"can this
person sign right now"*. AGENTS.md describes it as the free pre-flight that
"costs nothing" and "answers whether an identity already holds one" — accurate,
but weaker than the use it was being put to. It cannot be used to decide that a
`SIGNING` session will complete.

## 3 · `SIGN_QUOTA_EXHAUSTED` is terminal and has no remedy in the SDK

`categoryFor("SIGN_QUOTA_EXHAUSTED")` returns `terminal`, matching
`sdk-integracion__errores.md`, which also maps it to HTTP `402` — *"Sin saldo de
firma"*. Terminal means no retry within the step, which is why a failing
ceremony gives the signer one attempt at the key screen rather than the
*«se puede corregir en la misma pantalla»* the identity doc promises for a wrong
PIN. **A quota failure and a wrong PIN are indistinguishable to the signer.**

The SDK surface is:

```
SessionClient: createSession · getCatalog · getSigningEligibility · getSession
               completeSession · cancelSession · getSignedDocumentStatus
               verifyAndAcknowledgeSignedArtifact
HttpAuthTransport adds: bindSignedArtifact
```

No method reads a balance, and none allocates one. An integrator cannot gate a
ceremony it cannot price. The only remedy Lakaut documents is a **Comprar
firmas** button in the retail portal at `web-preprod.lakautac.com.ar/firma`,
which is not a step that can appear inside a borrower's signing flow.

## 4 · The balance appears to be per signer, and that is unconfirmed

The dashboard's Pagos screen is titled *"Listado de pagos asociados a tus
solicitudes (onboardings)"* and shows one row: **Plan Zero (2 firmas
digitales)**, `$0,00`, `FACTURACION_COMPLETADO`, dated 2026-09-05 — the same day
the certificate was issued — with an ONBOARDING id in the last column. That
reads as a per-person plan granted at onboarding.

Two credits existed. Two ceremonies failed. `Historial de firmas` shows *"Aún no
firmaste ningún documento"* over a window that covers both. So either an attempt
consumes a credit without producing a signature, or the balance was already zero
and neither attempt validated the PIN at all.

**Not confirmed, and the confound matters.** The account under test is both the
integration's `responsable técnico` and the test signer, so preproduction may be
conflating an integrator balance with a personal one. The dashboard panel that
would show contracted scope was stuck on *"Cargando alcance contratado…"* and
never rendered, which is a poor basis for concluding an integrator quota does
not exist.

The experiment that settles it is onboarding a **second, different identity**
and observing whether it arrives with its own two firmas.

**Resolved by the vendor, 2026-09-14.** Lakaut replied that *"el problema
radica en la asignación de firmas a la integración para que puedan ser
consumidas"*, and that an infrastructure migration is delaying the fix. The
balance that blocked both identities is allocated to the integration, not to
each signer. Still unanswered: whether an integration balance is also what a
production signer draws on, whether a failed attempt consumes a credit, and
whether any API will expose it (§10).

## 5 · The service emits a code the SDK does not declare

A third ceremony, run once the balance was already zero, ended with:

```
lakaut.flow.failed  errorCode=document_sign_failed  retryable=false
"The signing step cannot continue for this session."
```

It never reached the key screen — fourteen seconds separate `step_completed
step=email_otp` from the failure — which settles §4's other half: **the PIN was
never the problem.** Earlier runs offered a key screen; this one does not.

Two documented claims fail at once.

`sdk-integracion__referencia-api.md` states that *"`document_sign_failed` y
`signed_document_recovery_required` existen en `SdkPublicErrorCode` pero no
llegan como `errorCode` de un evento de ciclo de vida"*. It arrived as exactly
that.

And the code is absent from `LakautSdkErrorCode`, the 34-member union STYLES
§9.3 asks handlers to be exhaustive over. An exhaustive handler cannot match it,
so it falls through to `categoryFor`, whose default is `retry-in-step`.

**Here that default is the wrong direction.** §9.3 chose it because escalating
costs the whole flow, and being wrong that way costs one retry. But the event
says `retryable: false`: retrying returns the signer to a step that cannot
succeed, and no number of retries changes it. For browser lifecycle events the
event's own `retryable` outranks the classifier, and §9.3's rule should be read
as applying to the server error space, not this one.

Pinned by a test in `provider.test.ts`, which fails once Lakaut declares the
code.

## 6 · A failed signature is invisible to the backend

The webhook destination is **Verificado** and the challenge verified against our
endpoint. The ceremony above then failed, terminally, from the signer's point of
view — and **no event was delivered**. Ninety seconds of polling, nothing.

Nor should there have been, on the vendor's model: the *step* failed, the
*session* did not. `getSession` still reports `state: open`, `errorCode: null`.
There is no session-level transition, so there is no `auth.session.failed`.

The consequence is worth stating plainly. A signature can fail terminally for
the user while every backend channel reports a healthy, open session:

| Channel | What it said |
| --- | --- |
| Browser event | `document_sign_failed`, `retryable: false` |
| `getSession` | `open`, `errorCode: null` |
| Document status | `404 FORBIDDEN` |
| Webhook | nothing |

STYLES §9.1 says browser events can be lost and the backend is authoritative.
Both remain true. But this is the case the rule does not cover: the browser is
the *only* channel carrying the fact, and it is the one channel we are told not
to trust. A lost event here is a signer who saw a failure and a backend that
never learns of it.

Practical consequence for the core: a ceremony that stops emitting events
without reaching a terminal session state has to be swept — an open session with
no progress and no terminal transition is a real outcome, not a stuck record.

## 7 · `externalUserRef` binds permanently to one email

Verified 2026-09-13. The eligibility read accepts a `(externalUserRef, email)`
pair, and the first pairing is permanent:

| externalUserRef | email | Result |
| --- | --- | --- |
| `ar.pagare/fresh-a1` | `lucero@lucerolabs.xyz` (first use) | `ONBOARDING_REQUIRED` |
| `ar.pagare/fresh-a1` | `lucero@lucerolabs.xyz` (again) | `ONBOARDING_REQUIRED` |
| `ar.pagare/fresh-a1` | `otro@lucerolabs.xyz` | **`400 INVALID_REQUEST`** |
| `ar.pagare/demo-0001` | `scammi@gmail.com` (first use) | `READY_FOR_SIGNING` |
| `ar.pagare/demo-0001` | `hello@lucerolabs.xyz` | **`400 INVALID_REQUEST`** |

Defensible as a design — `externalUserRef` is our stable handle for a person, so
binding it to an identity is what makes it a handle. It is the *diagnosis* that
fails. The body is:

```json
{"code":"INVALID_REQUEST","message":"Request could not be processed"}
```

Nothing names the reference, the conflict, or the email it is already bound to.

This is not academic. It cost a real ceremony: the eligibility read failed with
that opaque 400, the demo's journey selector kept its default, and a `SIGNING`
session was opened for an identity holding no certificate — which authenticates
by OTP first and only then discovers there is nothing to sign with. The signer
spends an OTP to reach a wall.

Two consequences the core inherits. A reference is single-use per signer, so
generating one per loan is fine and reusing one across borrowers is a hard
failure. And eligibility failing is not a soft condition to log past: it means
the journey is unknown, and opening a ceremony anyway picks one at random.

## 8 · A freshly onboarded identity cannot sign either

Run 2026-09-13, and it settles §4. A second identity —
`hello@lucerolabs.xyz`, which had no certificate — was onboarded end to end
through `ONBOARDING_AND_SIGNING`: phone OTP, identity capture, live biometric
validation, certificate issued, and a signing PIN set by the signer. Eligibility
then reported `READY_FOR_SIGNING`.

The signature failed anyway, with the same terminal screen as the exhausted
account: *"No podemos completar la firma en este momento."* Session `open`,
`errorCode: null`, no webhook.

| | `scammi@gmail.com` | `hello@lucerolabs.xyz` |
| --- | --- | --- |
| Certificate | issued 2026-09-05 | issued minutes before signing |
| Eligibility | `READY_FOR_SIGNING` | `READY_FOR_SIGNING` |
| PIN | not recently set | **set by the signer, then used minutes later** |
| Signature | fails | fails identically |

Two things follow. The PIN hypothesis is dead: a key set and used within minutes
cannot be misremembered. And a fresh identity does **not** arrive with usable
signing capacity, which was the premise of the experiment — so the balance is
not per signer in any way that helps, and §4's open question resolves against
the per-signer reading.

The residual uncertainty is what to call it. `SIGN_QUOTA_EXHAUSTED` was never
observed directly; the browser reported `document_sign_failed` and quota is an
inference from the portal. What is observed, and is enough to act on, is that
**no identity in this integration can sign** — neither one holding a certificate
for a week nor one created minutes ago.

### Identity validation is live, and is not Veriff

Preproduction does not stub it. The widget ran a real biometric check and
rejected an attempt with *"Aseguraté de tener buena luz y que tu rostro este
despejado"*, allowing three attempts. So *«usá usuarios y documentos sintéticos
o autorizados»* resolves, for the identity step, to **autorizados**: a synthetic
person does not onboard.

The widget is branded **FID by Lakaut**. `sdk-integracion__flujos-identidad.md`
names *«validación de identidad con Veriff»* at step 4 and never mentions FID.

### The signer we onboarded has no portal login

`web-preprod.lakautac.com.ar` asks for a password the SDK flow never set, so an
identity onboarded through the SDK cannot reach the portal that shows its
signature balance.

Combined with §3 — no API reads a balance — this means an integrator has **no
channel at all**, programmatic or human, to see or manage the signature capacity
of a signer it onboarded itself.

## 9 · Consequences for the architecture

If §4 resolves to per-signer, capacity is metered per borrower in a product
where every borrower signs, and the multi-tenancy note in AGENTS.md gains a
second dimension: not just one `integratorId` across consumers, but a balance
that belongs to neither us nor the consumer.

Either way, §3 stands on its own. A terminal error with no observable
precondition and no programmatic remedy has to be handled as an operational
event — which means it needs a webhook, an alert and a human, not a retry.

## 10 · Questions for Lakaut

1. Is there an API to read a signer's remaining signature balance?
2. Can an integrator allocate or purchase signatures on a signer's behalf?
3. Should `getSigningEligibility` reflect quota? Today it returns
   `READY_FOR_SIGNING` at zero balance.
4. Does a failed signing attempt consume a credit?
5. Is the balance per signer or per integrator?
6. Please top up the preproduction balance for `lucerosa`.
7. The **Cargando alcance contratado…** panel never loads in the PREPROD
   dashboard.
8. `document_sign_failed` arrived as a lifecycle `errorCode`, which
   `referencia-api.md` says cannot happen, and it is not in
   `LakautSdkErrorCode`. Which is wrong, the docs or the union?
9. Should a terminal signing-step failure produce a webhook? Today the session
   stays `open` and nothing is delivered, so the browser event is the only
   record that the signature failed.
10. Reusing an `externalUserRef` with a second email returns a bare
    `INVALID_REQUEST`. Is the binding intentional, and can the error say so?
11. A freshly onboarded identity cannot sign either. Is signing blocked at the
    integration level rather than per signer?
12. The identity widget is branded FID; the documentation says Veriff. Which is
    current?
13. An identity onboarded through the SDK has no portal password, so neither we
    nor the signer can see their balance anywhere.

## Resolved 2026-09-21 · signatures work, and three things we learned

Lakaut allocated a package of 100 signatures to the integration after finishing
their environment migration. The same afternoon, three documents were signed in
preproduction and each verified against the provider's record through
`verifyAndAcknowledgeSignedArtifact`, with custody completing before the binding
(STYLES §9.5). Sessions `b8e0cb8c-…`, `6f07fe73-…` and `5507c634-…`.

**The account gate is per email, not per DNI.** `santi@divine.inc` — the same
person as the two existing accounts — onboarded end to end, received a new
certificate (`4667FF52E46CDCB2`) and signed. AGENTS.md had stated "one account
per DNI" without a citation; nothing in the vendor mirror says it, and this
disproves it. Any mailbox one controls is a new test signer. The identity step
remains live (§8), so the person still has to be real.

**A session stays `open` after a successful signature.** `getSession` reported
`state: open`, `errorCode: null` for every signed ceremony. The document being
signed and the session being closed are separate facts, which is what
`CeremonyState` having no `signed` state was built to express (signing-spine.md
§2.3); now it is observed rather than argued.

**Webhook verification is broken on the vendor's side.** With the destination
saved, a fresh secret installed and the endpoint answering 401 to unsigned
POSTs, *Verificar destino* fails with *"No se pudo completar la operación de
integraciones"* — and the tunnel's request log shows no request from Lakaut at
all. The verification window on a freshly generated secret also displays a time
already past. Reported to Lakaut the same day; `auth.document.signed` has still
never been observed from a real signature.

