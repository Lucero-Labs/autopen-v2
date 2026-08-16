# INVESTIGATION-001 — Is there a generalisable signing + evidence core?

**Type:** research only. Do not write implementation code.
**Deliverable:** `docs/research/RESULT-001-core-signing-evidence.md`

---

## Mission

Lucero is building a product on the Lakaut AC SDK. The first client product is
vehicle loan origination for Argentine dealerships: a *pagaré con garantía
prendaria* is drafted, sent to a borrower, signed with a verified identity, and
later used as an enforceable evidence package when the borrower defaults.

We expect there is a **core** underneath that survives changing the client
product — swap the contract being signed and the surrounding flow, and something
identifiable stays. We want that core named, bounded, and stress-tested *before*
anyone writes it.

Your job is to determine whether that core exists, where its edges are, and
above all **what Lakaut's SDK forces on us that constrains it**. The constraints
are the point. A confident abstraction that Lakaut cannot actually support is
worse than no answer.

## What you have

Everything you need is committed in this repository. Read all of it.

| Path | What it is |
| --- | --- |
| `docs/vendor/lakaut/` | The complete Lakaut SDK documentation, 21 pages, mirrored to markdown. Start with `sdk-integracion__agentes.md` — Lakaut wrote it specifically for code agents — then `referencia-api.md`, `backend-sesiones.md`, `documentos-firma.md`, `flujos-identidad.md`, `eventos-estado.md`, `errores.md`, `seguridad.md`. |
| `docs/vendor/lakaut/00-llms.txt` | Lakaut's own index of the above. |
| `docs/vendor/prototipo/README.md` | Distilled brief of the client product's design prototype. |
| `docs/vendor/prototipo/prototipo-lucero-v2.dc.html` | The prototype itself. Authoritative where the brief and it disagree. |

## Constraints on how you work

- **No network.** This environment cannot reach `lakaut-fd.github.io`,
  `lakautac.com.ar`, or the SDK sandbox. Do not try. The mirror is your source.
- **No installing `@lakaut/*`.** They live on a private registry this
  environment has neither credentials nor network access for. You are reasoning
  from documentation, not from the packages.
- **No implementation.** No `apps/`, no `packages/`, no scaffolding, no example
  code beyond short illustrative type sketches inside the deliverable.
- **Do not soften the answer.** If the core does not generalise, say so and say
  why. A well-evidenced negative is a successful outcome.

## The hypothesis to attack

> There is a provider-agnostic core that takes **(a document, a set of
> preconditions, one or more signer identities)** and produces **a verifiable
> evidence bundle**. The client product supplies the document template, the
> precondition rules, the signer roles, the delivery channel, and any
> post-signature artefacts. Lakaut is a swappable implementation of the identity
> and signature step inside that core.

Treat this as a claim to be falsified, not a conclusion to be dressed up. We
would rather learn it is wrong now.

## Questions

Weight your effort toward section B. That is where the answer will actually be
decided.

### A. The core

1. What operations does the core own, end to end? Name them.
2. What state does it own, and what is the lifecycle of that state? Where are the
   irreversible transitions?
3. What are the extension points a second client product would plug into
   (different contract, different flow, different jurisdiction)?
4. Which concepts in the prototype are genuinely universal, and which only look
   universal because we have exactly one example? Argue both sides.

### B. Lakaut's constraints — the emphasis

For each, answer from the docs, cite where, and state the impact on the core.

1. **Multi-party signing.** The pagaré carries two signature blocks — *firma del
   deudor* and *firma del acreedor*. A session appears to model one document and
   one signer. Can two parties sign one document? Sequential sessions over the
   same PDF? Does a second signature invalidate the first CMS signature? This is
   existential for a pagaré — resolve it or flag it loudly.
2. **One document per session.** `document` is a single object with a single
   `documentId`. What happens when an origination needs a pagaré *plus* a prenda
   form *plus* a consumer disclosure? Multiple documents per session, multiple
   sessions, or not supported?
3. **`allowedOrigin` is one exact origin** — no wildcards, no paths, registered
   per integrator in a dashboard. What tenancy models does that permit? If Lucero
   serves many dealerships, is there one origin for all, one per tenant, and what
   is the ceiling?
4. **Webhooks are one endpoint per integrator.** How does an event get routed
   back to the right tenant and the right loan? Is `externalUserRef` load-bearing
   for this? Is there any tenant dimension in the API at all, or is multi-tenancy
   entirely our problem?
5. **Certificate lifecycle.** A borrower takes a second loan a year later.
   `ONBOARDING_AND_SIGNING` again, or `SIGNING` against an existing certificate?
   How do we know which before creating the session? How long is a certificate
   valid, and does the borrower redo RENAPER each time?
6. **Flow rigidity.** `flowConfig.steps` and `journeyId` come from a server-side
   catalog. How much of the borrower's experience is ours versus Lakaut's? Can a
   client product reorder, skip, or insert steps? What is actually configurable?
7. **Hosted UI is a fixed-height iframe** requiring HTTPS and camera/microphone
   permissions. The borrower flow is a phone reached from a WhatsApp link. What
   does that constrain about the mobile surface, and about local development?
8. **What is actually in the evidence bundle.** The prototype promises five
   items: signed instrument, RENAPER-verified identity, prenda registration
   certificate, document validation, and a live liquidation. For each, determine
   whether Lakaut produces it, Lakaut attests to it, or Lucero must produce it.
   Be specific about identity: do we get *proof* of the RENAPER check we could
   put in front of a judge, or only a boolean?
9. **Timestamping and retention.** Is there a trusted timestamp on the signature,
   and whose? What does Lakaut retain, for how long, and what can we retrieve
   later? The docs distinguish an authoritative `signedContentHash` from a
   non-authoritative browser copy — work out what that means for being the
   system of record.
10. **Provider swappability.** If Lakaut were replaced, what breaks? Sort the
    SDK's concepts into ones that are universal to any qualified signature
    provider (certificate, CMS signature, OTP) versus ones specific to Lakaut or
    to Argentina (RENAPER, journeys, PIN semantics, error taxonomy).

### C. Limits of this investigation

1. What could not be answered from documentation alone, and what exactly should
   we ask Lakaut? Write these as questions we can paste into an email.
2. What must be verified against the live sandbox before we commit to a design?
3. Where is the documentation ambiguous, self-contradictory, or silent on
   something load-bearing?

## Deliverable

Write `docs/research/RESULT-001-core-signing-evidence.md` with these sections:

1. **Verdict** — does the core generalise? Two paragraphs, no hedging, up front.
2. **The core** — proposed boundary, operations, owned state, extension points.
   Type sketches welcome; they are illustration, not implementation.
3. **Constraints** — one subsection per B-question. Each states the constraint,
   cites the evidence, and gives the consequence for the core.
4. **Where it breaks** — the cases that do not fit, ranked by how likely they are
   to matter.
5. **Open questions for Lakaut** — paste-ready.
6. **To verify in the sandbox** — a concrete checklist.
7. **Recommendation** — what to build first, and what to defer until answered.

### Evidence discipline

Every substantive claim carries one of three tags:

- **[Documented]** — with the file and section it came from
- **[Inferred]** — with the reasoning, and what would confirm or refute it
- **[Unknown]** — say so plainly; do not fill the gap with a plausible guess

An honest **[Unknown]** is worth more to us than a confident **[Inferred]** that
turns out wrong six weeks into the build. Do not pad. If a section is short
because the evidence is thin, let it be short and say why.

## Done when

- `docs/research/RESULT-001-core-signing-evidence.md` exists with all seven
  sections
- Every B-question is answered or explicitly marked unanswerable, with reasons
- The work is committed to a branch and pushed
