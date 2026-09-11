import type { PolicyKey } from "./contracts.js";

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

/**
 * A stored document's hash disagrees with the id it is filed under.
 *
 * `seal` derives the id from the content, so a caller cannot cause this. It
 * means the document store returned a record that does not match its key, and
 * the safe response is to refuse rather than proceed on bytes we cannot vouch
 * for (§0.1).
 */
export class SealConflictError extends CoreError {
  constructor(
    readonly documentId: string,
    readonly storedHash: string,
    readonly computedHash: string,
  ) {
    super(
      `Document "${documentId}" is stored under hash "${storedHash}" but hashes to "${computedHash}"`,
    );
  }
}

/** No WebCrypto on this runtime, so nothing can be sealed or verified. */
export class HashUnavailableError extends CoreError {
  constructor() {
    super("globalThis.crypto.subtle is unavailable, so content cannot be hashed");
  }
}

/** A ceremony was asked about that the ledger has no record of. */
export class CeremonyNotFoundError extends CoreError {
  constructor(readonly ceremonyId: string) {
    super(`No ceremony recorded for "${ceremonyId}"`);
  }
}

/** A document was referenced that was never sealed. */
export class DocumentNotSealedError extends CoreError {
  constructor(readonly documentId: string) {
    super(`No sealed document for "${documentId}"`);
  }
}

/**
 * Custody did not complete, so the artefact is not evidence.
 *
 * Carries the provider's error code when it has one. The artefact is never
 * archived on this path and the binding is not registered (STYLES §9.5).
 */
export class CustodyFailedError extends CoreError {
  constructor(
    readonly documentId: string,
    override readonly cause: unknown,
  ) {
    super(`Custody failed for document "${documentId}"`);
  }
}
