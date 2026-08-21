import {
  DuplicatePolicyError,
  DuplicateRuleIdError,
  type Policy,
  type PolicyKey,
  type PolicyRegistry,
  type Rule,
} from "@autopen/core";

const keyOf = (key: PolicyKey): string => `${key.instrumentType}::${key.jurisdiction}`;

/**
 * Builds a policy, rejecting duplicate rule ids at construction time rather
 * than letting two findings collide at evaluation time.
 */
export function definePolicy<TSubject>(input: {
  id: string;
  version: string;
  rules: readonly Rule<TSubject>[];
}): Policy<TSubject> {
  const seen = new Set<string>();
  for (const rule of input.rules) {
    if (seen.has(rule.id)) throw new DuplicateRuleIdError(input.id, rule.id);
    seen.add(rule.id);
  }
  return Object.freeze({
    id: input.id,
    version: input.version,
    rules: Object.freeze([...input.rules]),
  });
}

/**
 * The default registry: policies held in memory, registered at composition
 * time. Swap it for a database- or file-backed implementation by writing
 * another `PolicyRegistry` — the gate never sees the difference.
 */
export class InMemoryPolicyRegistry<TSubject> implements PolicyRegistry<TSubject> {
  readonly #policies = new Map<string, { key: PolicyKey; policy: Policy<TSubject> }>();

  register(key: PolicyKey, policy: Policy<TSubject>): this {
    const id = keyOf(key);
    if (this.#policies.has(id)) throw new DuplicatePolicyError(key);
    this.#policies.set(id, { key, policy });
    return this;
  }

  resolve(key: PolicyKey): Policy<TSubject> | undefined {
    return this.#policies.get(keyOf(key))?.policy;
  }

  keys(): readonly PolicyKey[] {
    return [...this.#policies.values()].map((entry) => entry.key);
  }
}
