import type { CeremonyDisposition } from "@autopen/core";
import { categoryFor } from "@lakaut/shared-contracts";
import { describe, expect, it } from "vitest";

import { dispositionForFailure } from "../src/disposition.js";

describe("dispositionForFailure", () => {
  it("treats a failure the provider marked unretryable as terminal", () => {
    expect(dispositionForFailure({ errorCode: "signing_failed", retryable: false })).toBe(
      "terminal",
    );
  });

  it("does not escalate an unretryable failure to session-recovery", () => {
    // Recreating the session makes the signer redo OTP, identity and
    // certificate. The event said this step cannot continue, not that the
    // session is unusable (STYLES 9.3).
    const disposition: CeremonyDisposition = dispositionForFailure({
      errorCode: "signing_failed",
      retryable: false,
    });

    expect(disposition).not.toBe("session-recovery");
  });

  it("keeps a retryable failure inside its step", () => {
    expect(dispositionForFailure({ errorCode: "certificate_pin_invalid", retryable: true })).toBe(
      "retry-in-step",
    );
  });

  it("falls back to the SDK's classifier when the event states no verdict", () => {
    expect(dispositionForFailure({ errorCode: "certificate_pin_invalid" })).toBe(
      categoryFor("certificate_pin_invalid"),
    );
  });

  it("still defaults an unrecognised code to retry-in-step when nothing else is known", () => {
    expect(dispositionForFailure({ errorCode: "a_code_nobody_has_seen" })).toBe("retry-in-step");
  });

  /**
   * The case this function exists for. Observed against preproduction on
   * 2026-09-12: `document_sign_failed` with `retryable: false`, a code absent
   * from `LakautSdkErrorCode`, which `categoryFor` therefore defaults to
   * `retry-in-step`. Retrying returns the signer to a step that cannot succeed.
   */
  it("overrides the classifier for document_sign_failed, which it defaults wrongly", () => {
    expect(categoryFor("document_sign_failed")).toBe("retry-in-step");

    expect(dispositionForFailure({ errorCode: "document_sign_failed", retryable: false })).toBe(
      "terminal",
    );
  });
});
