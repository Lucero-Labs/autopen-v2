import { describe, expect, it } from "vitest";
import { PolicyNotFoundError, RuleEvaluationError, type Rule } from "@autopen/core";

import { definePolicy, InMemoryPolicyRegistry } from "../src/registry.js";
import { PolicyGate, type Clock } from "../src/policy-gate.js";
import { onlyWhen, predicate, required, rule, satisfied, withSeverity } from "../src/rules.js";

interface Subject {
  readonly name?: string | undefined;
  readonly kind: "a" | "b";
  readonly tags?: readonly string[] | undefined;
}

const KEY = { instrumentType: "test", jurisdiction: "XX" } as const;
const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });

const gateFor = (rules: readonly Rule<Subject>[], version = "1.0.0") => {
  const registry = new InMemoryPolicyRegistry<Subject>().register(
    KEY,
    definePolicy<Subject>({ id: "test.policy", version, rules }),
  );
  return new PolicyGate<Subject>(registry, { clock: fixedClock("2026-08-21T12:00:00.000Z") });
};

const nameRequired = required<Subject>({
  id: "name-required",
  description: "Name is required.",
  path: "name",
  select: (s) => s.name,
});

describe("PolicyGate", () => {
  it("is issuable when every rule is satisfied", async () => {
    const verdict = await gateFor([nameRequired]).evaluate({ name: "ok", kind: "a" }, KEY);

    expect(verdict.issuable).toBe(true);
    expect(verdict.findings).toEqual([]);
    expect(verdict.policyId).toBe("test.policy");
    expect(verdict.policyVersion).toBe("1.0.0");
    expect(verdict.evaluatedAt).toBe("2026-08-21T12:00:00.000Z");
  });

  it("blocks and reports the rule's description as the message", async () => {
    const verdict = await gateFor([nameRequired]).evaluate({ kind: "a" }, KEY);

    expect(verdict.issuable).toBe(false);
    expect(verdict.findings).toEqual([
      {
        ruleId: "name-required",
        severity: "blocking",
        message: "Name is required.",
        path: "name",
      },
    ]);
  });

  it("reports every failure at once rather than stopping at the first", async () => {
    const second = required<Subject>({
      id: "tags-required",
      description: "Tags are required.",
      path: "tags",
      select: (s) => s.tags,
    });

    const verdict = await gateFor([nameRequired, second]).evaluate({ kind: "a" }, KEY);

    expect(verdict.findings.map((f) => f.ruleId)).toEqual(["name-required", "tags-required"]);
  });

  it("preserves rule order in findings", async () => {
    const rules = ["r3", "r1", "r2"].map((id) =>
      predicate<Subject>({ id, description: id, holds: () => false }),
    );

    const verdict = await gateFor(rules).evaluate({ kind: "a" }, KEY);

    expect(verdict.findings.map((f) => f.ruleId)).toEqual(["r3", "r1", "r2"]);
  });

  it("an advisory finding is reported but does not block", async () => {
    const advisory = withSeverity<Subject>("advisory", nameRequired);

    const verdict = await gateFor([advisory]).evaluate({ kind: "a" }, KEY);

    expect(verdict.issuable).toBe(true);
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]?.severity).toBe("advisory");
  });

  it("blocks when a blocking rule fails alongside an advisory one", async () => {
    const advisory = predicate<Subject>({
      id: "advice",
      description: "advice",
      severity: "advisory",
      holds: () => false,
    });

    const verdict = await gateFor([nameRequired, advisory]).evaluate({ kind: "a" }, KEY);

    expect(verdict.issuable).toBe(false);
    expect(verdict.findings).toHaveLength(2);
  });

  it("awaits asynchronous rules", async () => {
    const asyncRule = predicate<Subject>({
      id: "async",
      description: "async check",
      // A microtask is enough to prove the engine awaits; using a timer would
      // drag Node types into a package whose source is runtime-agnostic.
      holds: async () => {
        await Promise.resolve();
        return false;
      },
    });

    const verdict = await gateFor([asyncRule]).evaluate({ kind: "a" }, KEY);

    expect(verdict.issuable).toBe(false);
  });

  it("passes an injected clock through to rules", async () => {
    let seen: Date | undefined;
    const clockReader = predicate<Subject>({
      id: "clock",
      description: "clock",
      holds: (_s, ctx) => {
        seen = ctx.now;
        return true;
      },
    });

    await gateFor([clockReader]).evaluate({ kind: "a" }, KEY);

    expect(seen?.toISOString()).toBe("2026-08-21T12:00:00.000Z");
  });

  it("lets a caller override context per evaluation", async () => {
    let locale: string | undefined;
    const localeReader = predicate<Subject>({
      id: "locale",
      description: "locale",
      holds: (_s, ctx) => {
        locale = ctx.locale;
        return true;
      },
    });

    await gateFor([localeReader]).evaluate({ kind: "a" }, KEY, { locale: "en-GB" });

    expect(locale).toBe("en-GB");
  });

  it("defaults the locale to es-AR", async () => {
    let locale: string | undefined;
    const localeReader = predicate<Subject>({
      id: "locale",
      description: "locale",
      holds: (_s, ctx) => {
        locale = ctx.locale;
        return true;
      },
    });

    await gateFor([localeReader]).evaluate({ kind: "a" }, KEY);

    expect(locale).toBe("es-AR");
  });

  it("throws rather than guessing when no policy is registered", async () => {
    const gate = new PolicyGate<Subject>(new InMemoryPolicyRegistry<Subject>());

    await expect(gate.evaluate({ kind: "a" }, KEY)).rejects.toBeInstanceOf(PolicyNotFoundError);
  });

  it("propagates a throwing rule instead of reporting a false verdict", async () => {
    const explodes = rule<Subject>({
      id: "boom",
      description: "boom",
      evaluate: () => {
        throw new Error("registry unreachable");
      },
    });

    await expect(gateFor([explodes]).evaluate({ kind: "a" }, KEY)).rejects.toBeInstanceOf(
      RuleEvaluationError,
    );
  });

  it("names the offending rule when one throws", async () => {
    const explodes = rule<Subject>({
      id: "boom",
      description: "boom",
      evaluate: async () => {
        throw new Error("nope");
      },
    });

    await expect(gateFor([explodes]).evaluate({ kind: "a" }, KEY)).rejects.toMatchObject({
      ruleId: "boom",
    });
  });

  it("an empty policy is issuable — configured permissiveness, not an accident", async () => {
    const verdict = await gateFor([]).evaluate({ kind: "a" }, KEY);

    expect(verdict.issuable).toBe(true);
    expect(verdict.findings).toEqual([]);
  });
});

describe("required", () => {
  it.each([
    ["undefined", undefined, false],
    ["empty string", "", false],
    ["whitespace", "   ", false],
    ["empty array", [], false],
    ["a value", "x", true],
    ["zero", 0, true],
    ["false", false, true],
  ])("treats %s as present=%s", async (_label, value, expected) => {
    const r = required<{ v: unknown }>({
      id: "v",
      description: "v",
      path: "v",
      select: (s) => s.v,
    });
    const registry = new InMemoryPolicyRegistry<{ v: unknown }>().register(
      KEY,
      definePolicy({ id: "p", version: "1", rules: [r] }),
    );
    const verdict = await new PolicyGate(registry).evaluate({ v: value }, KEY);

    expect(verdict.issuable).toBe(expected);
  });
});

describe("onlyWhen", () => {
  const wrapped = onlyWhen<Subject>((s) => s.kind === "a", nameRequired);

  it("applies the inner rule when the condition holds", async () => {
    const verdict = await gateFor([wrapped]).evaluate({ kind: "a" }, KEY);
    expect(verdict.issuable).toBe(false);
  });

  it("reports no finding at all when the condition does not hold", async () => {
    const verdict = await gateFor([wrapped]).evaluate({ kind: "b" }, KEY);
    expect(verdict.issuable).toBe(true);
    expect(verdict.findings).toEqual([]);
  });

  it("keeps the inner rule's identity and severity", () => {
    expect(wrapped.id).toBe(nameRequired.id);
    expect(wrapped.severity).toBe(nameRequired.severity);
  });
});

describe("definePolicy", () => {
  it("rejects duplicate rule ids at construction time", () => {
    expect(() =>
      definePolicy<Subject>({
        id: "dup",
        version: "1",
        rules: [nameRequired, nameRequired],
      }),
    ).toThrow(/more than once/);
  });
});

describe("InMemoryPolicyRegistry", () => {
  it("rejects a second policy for the same key", () => {
    const registry = new InMemoryPolicyRegistry<Subject>().register(
      KEY,
      definePolicy<Subject>({ id: "a", version: "1", rules: [] }),
    );

    expect(() =>
      registry.register(KEY, definePolicy<Subject>({ id: "b", version: "1", rules: [] })),
    ).toThrow(/already registered/);
  });

  it("resolves by instrument type and jurisdiction independently", () => {
    const other = { instrumentType: "test", jurisdiction: "UY" } as const;
    const registry = new InMemoryPolicyRegistry<Subject>()
      .register(KEY, definePolicy<Subject>({ id: "ar", version: "1", rules: [] }))
      .register(other, definePolicy<Subject>({ id: "uy", version: "1", rules: [] }));

    expect(registry.resolve(KEY)?.id).toBe("ar");
    expect(registry.resolve(other)?.id).toBe("uy");
    expect(registry.keys()).toHaveLength(2);
  });

  it("returns undefined for an unknown key", () => {
    expect(new InMemoryPolicyRegistry<Subject>().resolve(KEY)).toBeUndefined();
  });
});

describe("rule helpers", () => {
  it("defaults severity to blocking", () => {
    expect(rule<Subject>({ id: "x", description: "x", evaluate: satisfied }).severity).toBe(
      "blocking",
    );
  });
});
