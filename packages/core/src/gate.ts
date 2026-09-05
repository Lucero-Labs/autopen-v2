/**
 * Gate contracts.
 *
 * The gate decides whether a subject may proceed to an irreversible step. It is
 * deliberately ignorant of what the subject is: the engine evaluates rules, and
 * the rules are supplied by whoever configures the policy. Nothing here knows
 * about pagarés, Argentina, or any provider.
 */

/**
 * `blocking` stops the subject from proceeding. `advisory` is surfaced to a
 * human but does not gate anything.
 */
export type Severity = "blocking" | "advisory";

/** Everything a rule may need that is not the subject itself. */
export interface RuleContext {
  /** Injected rather than read from the clock, so rules stay testable. */
  readonly now: Date;
  /** BCP-47 tag; rules use it to pick a message. */
  readonly locale: string;
  /** Escape hatch for caller-supplied values. Rules must tolerate absence. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * The result of evaluating one rule. A rule reports whether the subject
 * satisfies it; it never decides what that means for the flow — severity does.
 */
export type RuleOutcome =
  | { readonly satisfied: true }
  | {
      readonly satisfied: false;
      /** Overrides the rule's default description in the finding. */
      readonly message?: string;
      /** Dotted path to the offending field, for form highlighting. */
      readonly path?: string;
      readonly details?: Readonly<Record<string, unknown>>;
    };

/**
 * A single named check over a subject.
 *
 * `evaluate` may return a promise: some checks need I/O (a registry lookup, a
 * pricing service). The engine awaits either form, so synchronous rules cost
 * nothing.
 */
export interface Rule<TSubject> {
  readonly id: string;
  readonly severity: Severity;
  /** Human-readable, and the default message when a rule fails. */
  readonly description: string;
  evaluate(subject: TSubject, context: RuleContext): RuleOutcome | Promise<RuleOutcome>;
}

/** An ordered, versioned set of rules. Versioned because verdicts are recorded. */
export interface Policy<TSubject> {
  readonly id: string;
  readonly version: string;
  readonly rules: readonly Rule<TSubject>[];
}

/**
 * How a policy is looked up. Two axes cover the cases we know of: a second
 * client product (different instrument) and a second country (different rules
 * for the same instrument).
 */
export interface PolicyKey {
  readonly instrumentType: string;
  readonly jurisdiction: string;
}

/**
 * Resolves a policy for a key.
 *
 * Generic in the subject rather than per-call, so a registry cannot hand back a
 * policy written for a different shape. One registry serves one subject family.
 */
export interface PolicyRegistry<TSubject> {
  resolve(key: PolicyKey): Policy<TSubject> | undefined;
  keys(): readonly PolicyKey[];
}

/** What failed, why, and where. */
export interface Finding {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly message: string;
  readonly path?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * The gate's answer. Carries the policy identity so a stored verdict stays
 * meaningful after the rules change.
 */
export interface GateVerdict {
  readonly policyId: string;
  readonly policyVersion: string;
  /** True when no blocking finding was produced. Advisories do not gate. */
  readonly issuable: boolean;
  readonly findings: readonly Finding[];
  readonly evaluatedAt: string;
}

/** Per-call overrides; the engine supplies defaults for anything omitted. */
export type RuleContextOverrides = Partial<RuleContext>;

export interface Gate<TSubject> {
  evaluate(
    subject: TSubject,
    key: PolicyKey,
    overrides?: RuleContextOverrides,
  ): Promise<GateVerdict>;
}
