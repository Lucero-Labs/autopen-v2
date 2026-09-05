import {
  PolicyNotFoundError,
  RuleEvaluationError,
  type Finding,
  type Gate,
  type GateVerdict,
  type PolicyKey,
  type PolicyRegistry,
  type Rule,
  type RuleContext,
  type RuleContextOverrides,
  type RuleOutcome,
} from "@autopen/core";

/** Injected so verdict timestamps are deterministic under test. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface PolicyGateOptions {
  readonly clock?: Clock;
  readonly defaultLocale?: string;
}

/**
 * Runs a policy's rules over a subject and reports one verdict.
 *
 * Two decisions worth knowing about:
 *
 * - **Every rule runs.** The gate does not stop at the first blocking finding,
 *   because the caller is a form that should show every problem at once rather
 *   than one per round-trip.
 * - **A throwing rule fails the whole evaluation.** If a rule cannot decide,
 *   the subject's issuability is unknown, and returning `issuable: false` would
 *   be indistinguishable from a real finding while `true` would be dangerous.
 */
export class PolicyGate<TSubject> implements Gate<TSubject> {
  readonly #registry: PolicyRegistry<TSubject>;
  readonly #clock: Clock;
  readonly #defaultLocale: string;

  constructor(registry: PolicyRegistry<TSubject>, options: PolicyGateOptions = {}) {
    this.#registry = registry;
    this.#clock = options.clock ?? systemClock;
    this.#defaultLocale = options.defaultLocale ?? "es-AR";
  }

  async evaluate(
    subject: TSubject,
    key: PolicyKey,
    overrides: RuleContextOverrides = {},
  ): Promise<GateVerdict> {
    const policy = this.#registry.resolve(key);
    if (policy === undefined) throw new PolicyNotFoundError(key);

    const now = overrides.now ?? this.#clock.now();
    const context: RuleContext = {
      now,
      locale: overrides.locale ?? this.#defaultLocale,
      metadata: overrides.metadata ?? {},
    };

    const outcomes = await Promise.all(
      policy.rules.map(async (rule) => ({
        rule,
        outcome: await this.#runRule(rule, subject, context),
      })),
    );

    // flatMap rather than filter+map: the ternary narrows the union, a filter
    // predicate does not.
    const findings = outcomes.flatMap(({ rule, outcome }) =>
      outcome.satisfied ? [] : [toFinding(rule, outcome)],
    );

    return Object.freeze({
      policyId: policy.id,
      policyVersion: policy.version,
      issuable: !findings.some((finding) => finding.severity === "blocking"),
      findings: Object.freeze(findings),
      evaluatedAt: now.toISOString(),
    });
  }

  async #runRule(
    rule: Rule<TSubject>,
    subject: TSubject,
    context: RuleContext,
  ): Promise<RuleOutcome> {
    try {
      return await rule.evaluate(subject, context);
    } catch (cause) {
      throw new RuleEvaluationError(rule.id, cause);
    }
  }
}

function toFinding<TSubject>(
  rule: Rule<TSubject>,
  outcome: Extract<RuleOutcome, { satisfied: false }>,
): Finding {
  return Object.freeze({
    ruleId: rule.id,
    severity: rule.severity,
    message: outcome.message ?? rule.description,
    ...(outcome.path !== undefined ? { path: outcome.path } : {}),
    ...(outcome.details !== undefined ? { details: outcome.details } : {}),
  });
}
