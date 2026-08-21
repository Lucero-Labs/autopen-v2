# @autopen/gate

Decides whether a subject may proceed to an irreversible step.

The engine knows nothing about what it is gating. It resolves a **policy** for a
key, runs that policy's **rules**, and returns a **verdict**. Everything
product- or country-specific lives in the rules you register.

## Configuring it

A policy is data. Compose one from rule factories, register it under a key, and
hand the registry to the gate:

```ts
import { definePolicy, InMemoryPolicyRegistry, PolicyGate, required, onlyWhen } from "@autopen/gate";

const policy = definePolicy<LeaseDraft>({
  id: "uy.lease.v1",
  version: "1.0.0",
  rules: [
    required({ id: "uy.lease.deposit", description: "Depósito requerido.", path: "deposit", select: (d) => d.deposit }),
    onlyWhen((d) => d.term > 12, required({ /* … */ })),
  ],
});

const gate = new PolicyGate(
  new InMemoryPolicyRegistry<LeaseDraft>().register(
    { instrumentType: "lease", jurisdiction: "UY" },
    policy,
  ),
);

const verdict = await gate.evaluate(draft, { instrumentType: "lease", jurisdiction: "UY" });
if (!verdict.issuable) showBlockers(verdict.findings);
```

`@autopen/rules-pagare-ar` is a worked example: the Argentine pagaré rule set,
with nothing engine-specific in it.

## The four extension points

| Want to change | Do this |
| --- | --- |
| Which rules apply | Register a different policy under the key |
| A rule's parameters | Rule factories take config — `required({ path, select })` |
| When a rule applies | Wrap it: `onlyWhen(condition, rule)` |
| Where policies come from | Implement `PolicyRegistry` — database, file, feature flag |

Severity is the other lever: `blocking` stops the flow, `advisory` is shown but
does not gate. `withSeverity` re-labels a shared rule so a strict and a lenient
policy can reuse one definition.

## Decisions worth knowing

**Every rule runs.** The gate does not stop at the first blocking finding — the
caller is usually a form, and showing one problem per round-trip is hostile.

**A throwing rule fails the evaluation.** If a rule cannot decide, issuability
is unknown. Returning `issuable: false` would be indistinguishable from a real
finding, and `true` would be dangerous, so `RuleEvaluationError` propagates.

**An unregistered key throws.** Silently issuing an instrument because nobody
configured rules for its jurisdiction is the exact failure this exists to
prevent. An instrument type with no requisites registers an explicit empty
policy to say so out loud.

**Verdicts name their policy version.** A stored verdict has to stay explicable
after the rules change. Bump `version` whenever a rule set changes.

**Rules are async-capable.** `evaluate` may return a promise, so a rule can call
a registry or a pricing service. Synchronous rules cost nothing.

**The clock is injected.** Verdict timestamps and date rules are deterministic
under test.
