import type { Rule, RuleContext, RuleOutcome, Severity } from "@autopen/core";

/** A rule is satisfied. Shared frozen value — the outcome carries no data. */
const SATISFIED: RuleOutcome = Object.freeze({ satisfied: true as const });

export const satisfied = (): RuleOutcome => SATISFIED;

export const unsatisfied = (input?: {
  message?: string;
  path?: string;
  details?: Readonly<Record<string, unknown>>;
}): RuleOutcome => ({
  satisfied: false,
  ...(input?.message !== undefined ? { message: input.message } : {}),
  ...(input?.path !== undefined ? { path: input.path } : {}),
  ...(input?.details !== undefined ? { details: input.details } : {}),
});

/**
 * The general factory: everything below is a specialisation of this.
 *
 * Rules are data-configured rather than subclassed, so a policy can be
 * assembled from values without anyone writing a class.
 */
export function rule<TSubject>(input: {
  id: string;
  description: string;
  severity?: Severity;
  evaluate: (subject: TSubject, context: RuleContext) => RuleOutcome | Promise<RuleOutcome>;
}): Rule<TSubject> {
  return Object.freeze({
    id: input.id,
    description: input.description,
    severity: input.severity ?? "blocking",
    evaluate: input.evaluate,
  });
}

/**
 * Passes when `predicate` is true.
 *
 * The common case, and the one to reach for before writing a bespoke rule.
 */
export function predicate<TSubject>(input: {
  id: string;
  description: string;
  severity?: Severity;
  path?: string;
  holds: (subject: TSubject, context: RuleContext) => boolean | Promise<boolean>;
}): Rule<TSubject> {
  return rule<TSubject>({
    id: input.id,
    description: input.description,
    ...(input.severity !== undefined ? { severity: input.severity } : {}),
    evaluate: async (subject, context) => {
      const ok = await input.holds(subject, context);
      return ok
        ? satisfied()
        : unsatisfied(input.path !== undefined ? { path: input.path } : undefined);
    },
  });
}

/** Absent, null, or whitespace-only counts as missing. Zero and false do not. */
const isPresent = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

/**
 * Requires a field to be present.
 *
 * `select` rather than a dotted string so the compiler checks the field exists;
 * `path` is only for pointing a form at it.
 */
export function required<TSubject>(input: {
  id: string;
  description: string;
  path: string;
  severity?: Severity;
  select: (subject: TSubject) => unknown;
}): Rule<TSubject> {
  return rule<TSubject>({
    id: input.id,
    description: input.description,
    ...(input.severity !== undefined ? { severity: input.severity } : {}),
    evaluate: (subject) =>
      isPresent(input.select(subject)) ? satisfied() : unsatisfied({ path: input.path }),
  });
}

/**
 * Applies an inner rule only when `when` holds; otherwise reports satisfied.
 *
 * This is how conditional obligations stay declarative — "required only for a
 * natural person" is a wrapper, not an `if` buried inside a rule body.
 */
export function onlyWhen<TSubject>(
  when: (subject: TSubject, context: RuleContext) => boolean | Promise<boolean>,
  inner: Rule<TSubject>,
): Rule<TSubject> {
  return Object.freeze({
    id: inner.id,
    description: inner.description,
    severity: inner.severity,
    evaluate: async (subject: TSubject, context: RuleContext) =>
      (await when(subject, context)) ? inner.evaluate(subject, context) : satisfied(),
  });
}

/** Same rule, different severity. Lets one library serve a strict and a lenient policy. */
export function withSeverity<TSubject>(severity: Severity, inner: Rule<TSubject>): Rule<TSubject> {
  return Object.freeze({ ...inner, severity });
}
