import type { PolicyKey } from "./gate.js";

/** Base class so callers can catch everything this domain throws. */
export class CoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * No policy is registered for the key.
 *
 * Deliberately an error rather than an empty policy: silently issuing an
 * instrument because nobody configured rules for its jurisdiction is the
 * failure mode this whole abstraction exists to prevent. An unrestricted
 * instrument type must register an explicit empty policy to say so.
 */
export class PolicyNotFoundError extends CoreError {
  constructor(readonly key: PolicyKey) {
    super(
      `No policy registered for instrumentType="${key.instrumentType}" jurisdiction="${key.jurisdiction}"`,
    );
  }
}

/** Two policies registered under the same key. */
export class DuplicatePolicyError extends CoreError {
  constructor(readonly key: PolicyKey) {
    super(
      `A policy is already registered for instrumentType="${key.instrumentType}" jurisdiction="${key.jurisdiction}"`,
    );
  }
}

/** Two rules in one policy share an id, so findings could not be attributed. */
export class DuplicateRuleIdError extends CoreError {
  constructor(
    readonly policyId: string,
    readonly ruleId: string,
  ) {
    super(`Policy "${policyId}" declares rule id "${ruleId}" more than once`);
  }
}

/** A rule threw. The subject's issuability is unknown, so the gate refuses to guess. */
export class RuleEvaluationError extends CoreError {
  constructor(
    readonly ruleId: string,
    override readonly cause: unknown,
  ) {
    super(`Rule "${ruleId}" threw during evaluation`);
  }
}
