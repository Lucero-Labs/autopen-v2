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

## 5 · Consequences for the architecture

If §4 resolves to per-signer, capacity is metered per borrower in a product
where every borrower signs, and the multi-tenancy note in AGENTS.md gains a
second dimension: not just one `integratorId` across consumers, but a balance
that belongs to neither us nor the consumer.

Either way, §3 stands on its own. A terminal error with no observable
precondition and no programmatic remedy has to be handled as an operational
event — which means it needs a webhook, an alert and a human, not a retry.

## 6 · Questions for Lakaut

1. Is there an API to read a signer's remaining signature balance?
2. Can an integrator allocate or purchase signatures on a signer's behalf?
3. Should `getSigningEligibility` reflect quota? Today it returns
   `READY_FOR_SIGNING` at zero balance.
4. Does a failed signing attempt consume a credit?
5. Is the balance per signer or per integrator?
6. Please top up the preproduction balance for `lucerosa`.
7. The **Cargando alcance contratado…** panel never loads in the PREPROD
   dashboard.
