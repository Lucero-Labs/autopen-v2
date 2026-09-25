# autopen-v2

A **signing and evidence core**. Given a PDF and a set of precondition rules, it
gates the document, seals it, runs a qualified-signature ceremony through
[Lakaut](https://lakautac.com.ar), an Argentine certifying authority, verifies
the signed artefact and keeps custody of it.

It is built to be the same core under more than one product. A product supplies
its own document, its own rules and its own UI; the core supplies everything
between "these bytes" and "this person signed them, and here is the proof". The
first product is Lucero's Argentine *pagaré*.

## Where to look

| Question | Read |
| --- | --- |
| I want to build a product on this. What do I call, what do I own? | [`docs/building-on-autopen.md`](docs/building-on-autopen.md) |
| Why is the core shaped this way? | `docs/research/RESULT-001-core-signing-evidence.md` §1–§3, then the `ADDENDUM` |
| What is the work? | The open GitHub issues |
| What does the vendor actually say? | `docs/vendor/lakaut/` — a faithful mirror at SDK `0.1.0-rc.40` |
| How do I work in this repo? | [`AGENTS.md`](AGENTS.md) (the repo), [`STYLES.md`](STYLES.md) (the code) |

## What exists

The core — product-agnostic, and the part any product builds on:

```
packages/core/             contracts, error classes, and the signing spine. Zero dependencies.
packages/gate/             PolicyGate engine, InMemoryPolicyRegistry, rule factories
packages/adapter-lakaut/   the Lakaut provider, behind the SignatureProvider port
packages/tsconfig/         shared compiler settings
```

And the service:

```
apps/signing-service/      the API products call and the page signers open; deploys as one container
```

The spine is `seal → openCeremony → ingest → reconcile`, with
`@autopen/adapter-lakaut` implementing the provider port against the SDK at
exact `0.1.0-rc.40`. It has signed real documents in preproduction, end to end,
with custody verified against the provider's record. `@autopen/gate` decides
whether a subject may proceed, knowing nothing about what it is gating;
`packages/gate/README.md` shows how to compose a policy.

Not built yet: the evidence bundle (`assemble`), durable stores, and a webhook
relay so that more than one product can receive events — Lakaut allows one
webhook URL per environment. See AGENTS.md, "Vendor access", for why
preproduction is not a scratch environment.

## Running it

Node 22 and pnpm 10.11.1, both pinned (`.nvmrc`, `packageManager`). With Corepack
enabled, pnpm installs itself at the right version.

```bash
pnpm install --frozen-lockfile
pnpm check        # biome — format + lint (`check:fix` to apply)
pnpm build        # tsc per package → dist/
pnpm typecheck
pnpm test         # vitest
pnpm verify       # all of the above, in order — scripts/verify.sh
```

`pnpm verify` is the one command that must pass identically on a laptop and in a
Claude Code cloud session. Filter to one package with
`pnpm test --filter=@autopen/gate`.
