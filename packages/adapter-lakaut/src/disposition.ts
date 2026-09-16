/**
 * What a browser-side failure means for the flow.
 *
 * Its own module rather than a helper inside `renderer.ts` because it is a
 * decision, not a detail: it is the thing that decides whether a signer is
 * asked to try again, and `renderer.ts` builds against DOM types and cannot be
 * tested from Node (STYLES §1.2, §10).
 */

import type { CeremonyDisposition } from "@autopen/core";
import { categoryFor } from "@lakaut/shared-contracts";

/** The parts of a failed lifecycle event that decide what to do about it. */
export interface FailureSignal {
  readonly errorCode: string;
  /** Absent when the provider did not state one. */
  readonly retryable?: boolean | undefined;
}

/**
 * Decides a disposition, preferring the event's own verdict to the classifier.
 *
 * STYLES §9.3 says to classify by code and treat an unrecognised code as
 * `retry-in-step`, because escalating makes the signer redo OTP and identity.
 * That rule was written for the *server* error space, and applying it to
 * browser events is actively wrong — demonstrated against preproduction on
 * 2026-09-12.
 *
 * A ceremony failed with `errorCode: "document_sign_failed"`,
 * `retryable: false`. That code is not in `LakautSdkErrorCode`, so no
 * exhaustive handler can match it, and `categoryFor` defaults it to
 * `retry-in-step`. Retrying returns the signer to a step that cannot succeed,
 * however many times it is attempted (`docs/research/ADDENDUM-quota.md` §5).
 *
 * So `retryable` wins wherever the event states it. `false` becomes `terminal`
 * rather than `session-recovery`: the event says this step cannot continue, not
 * that the session must be rebuilt, and recreating it is the escalation §9.3
 * exists to prevent. Where the event says nothing, the classifier decides and
 * its safe default applies.
 */
export function dispositionForFailure(signal: FailureSignal): CeremonyDisposition {
  if (signal.retryable === false) return "terminal";
  if (signal.retryable === true) return "retry-in-step";
  return categoryFor(signal.errorCode);
}
