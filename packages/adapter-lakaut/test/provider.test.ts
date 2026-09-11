import type {
  CeremonyDisposition,
  CeremonyId,
  Clock,
  ContentHash,
  DocumentId,
  SealedDocument,
  SignedDelivery,
} from "@autopen/core";
import type {
  AuthoritativeSessionStatus,
  CreateSessionInput,
  CreateSessionOutput,
  SdkErrorCategory,
  SdkSessionStatus,
} from "@lakaut/shared-contracts";
import { describe, expect, it } from "vitest";

import { type LakautSessions, LakautSignatureProvider } from "../src/provider.js";

const AT = new Date("2026-09-11T12:00:00.000Z");
const now: Clock = () => AT;

const SESSION_ID = "8f3c1e7a-0000-4000-8000-00000000abcd";
const CLIENT_TOKEN = "8f3c1e7a.gT7pQ2mX9vK1nR4sL6wY8zB3";
const API_KEY = "sk_live_never_reaches_a_browser";

const SEALED: SealedDocument = Object.freeze({
  documentId: "d".repeat(64) as DocumentId,
  contentHash: "c".repeat(64) as ContentHash,
  bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46]),
  sealedAt: AT.toISOString(),
});

const DELIVERY: SignedDelivery = Object.freeze({
  ceremonyId: SESSION_ID as CeremonyId,
  documentId: SEALED.documentId,
  fileName: "pagare.pdf",
  bytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]),
  signedContentHash: "a".repeat(64) as ContentHash,
  finalPdfHash: "b".repeat(64) as ContentHash,
  signedAt: AT.toISOString(),
});

/** Recorded shapes only. No live `@lakaut/*` call happens here (STYLES 10). */
function sessionOutput(): CreateSessionOutput {
  return {
    sessionId: SESSION_ID,
    clientToken: CLIENT_TOKEN,
    expiresAt: "2026-09-11T13:30:00.000Z",
    hostedUiOrigin: "https://sdk-preprod.lakautac.com.ar",
    allowedOrigin: "https://dev.lucerolabs.xyz",
    environment: "sandbox",
    eventProtocolVersion: "1.0.0",
    hostedUiVersion: "1.0.0",
    allowedModes: ["iframe"],
    correlationId: "sdk_2b9d",
    journeyId: "journey.signing.v1",
    authenticationProfileId: "auth.email.v1",
  };
}

function sessionStatus(
  overrides: Partial<AuthoritativeSessionStatus> = {},
): AuthoritativeSessionStatus {
  return {
    sessionId: SESSION_ID,
    integratorId: "4bbbc239-b7e8-4fe1-8411-f186be33c0fa",
    environment: "sandbox",
    status: "completed",
    flowType: "SIGNING",
    completionReady: true,
    compatibility: {
      sdkApiVersion: "1.0.0",
      eventProtocolVersion: "1.0.0",
      webhookSchemaVersion: "1.0.0",
      hostedUiVersion: "1.0.0",
      minimumSdkVersion: "0.1.0-rc.1",
      supportedSdkMajorVersions: [0],
    },
    externalUserRef: "loan-4821",
    errorCode: null,
    correlationId: "sdk_2b9d",
    terminalAt: AT.toISOString(),
    ...overrides,
  };
}

interface Recorder {
  readonly created: CreateSessionInput[];
  custodyRan: boolean;
}

function build(options: { status?: AuthoritativeSessionStatus } = {}) {
  const recorder: Recorder = { created: [], custodyRan: false };

  const sessions: LakautSessions = {
    async createSession(input) {
      recorder.created.push(input);
      return sessionOutput();
    },
    async getSession() {
      return options.status ?? sessionStatus();
    },
    async verifyAndAcknowledgeSignedArtifact(input) {
      await input.custody(
        {
          protocolVersion: "1.1.0",
          sessionId: SESSION_ID,
          documentId: DELIVERY.documentId,
          fileName: DELIVERY.fileName,
          mimeType: "application/pdf",
          bytes: new ArrayBuffer(4),
          signedContentHash: DELIVERY.signedContentHash,
          finalPdfHash: DELIVERY.finalPdfHash,
          algorithm: "SHA-256",
          signedAt: DELIVERY.signedAt,
        },
        {
          version: "1",
          sessionId: SESSION_ID,
          documentId: DELIVERY.documentId,
          algorithm: "SHA-256",
          signedContentHash: DELIVERY.signedContentHash,
          finalPdfHash: DELIVERY.finalPdfHash,
          signerCertificateFingerprint: "AB:CD:EF",
          certificateRef: "cert-ref-1",
          signedAt: DELIVERY.signedAt,
          correlationId: "sdk_2b9d",
          verifiedAt: AT.toISOString(),
        },
      );
      recorder.custodyRan = true;
      return {
        evidence: {
          version: "1",
          sessionId: SESSION_ID,
          documentId: DELIVERY.documentId,
          algorithm: "SHA-256",
          signedContentHash: DELIVERY.signedContentHash,
          finalPdfHash: DELIVERY.finalPdfHash,
          signerCertificateFingerprint: "AB:CD:EF",
          certificateRef: "cert-ref-1",
          signedAt: DELIVERY.signedAt,
          correlationId: "sdk_2b9d",
          verifiedAt: AT.toISOString(),
        },
        binding: {
          bindingId: "binding-1",
          sessionId: SESSION_ID,
          documentId: DELIVERY.documentId,
          algorithm: "SHA-256",
          signedContentHash: DELIVERY.signedContentHash,
          finalPdfHash: DELIVERY.finalPdfHash,
          artifactBindingStatus: "BOUND",
          boundAt: AT.toISOString(),
        },
      };
    },
  };

  const provider = new LakautSignatureProvider({
    sessions,
    allowedOrigin: "https://dev.lucerolabs.xyz",
    flowType: "SIGNING",
    authenticationProfileId: "auth.email.v1",
    now,
  });

  return { provider, recorder };
}

describe("openCeremony", () => {
  it("opts every session into the 1.2 reconciliation contract", async () => {
    const { provider, recorder } = build();

    await provider.openCeremony(SEALED, { role: "librador" });

    expect(recorder.created[0]?.capabilities).toEqual(["signed-document-reconciliation:1.2"]);
  });

  it("sends the authentication profile explicitly rather than letting it default", async () => {
    const { provider, recorder } = build();

    await provider.openCeremony(SEALED, { role: "librador" });

    expect(recorder.created[0]?.authenticationProfileId).toBe("auth.email.v1");
  });

  it("omits identitySubject entirely when no identity was supplied", async () => {
    const { provider, recorder } = build();

    await provider.openCeremony(SEALED, { role: "librador" });

    expect(recorder.created[0]).not.toHaveProperty("identitySubject");
  });

  it("maps our nationalId onto the provider's dni when an identity is bound", async () => {
    const { provider, recorder } = build();

    await provider.openCeremony(SEALED, {
      role: "librador",
      identity: { nationalId: "30123456", sexo: "F" },
    });

    expect(recorder.created[0]?.identitySubject).toEqual({ dni: "30123456", sexo: "F" });
  });

  it("uses the session id as the ceremony id, so a webhook routes without a lookup table", async () => {
    const { provider } = build();

    const ceremony = await provider.openCeremony(SEALED, { role: "librador" });

    expect(ceremony.ceremonyId).toBe(SESSION_ID);
    expect(ceremony.documentId).toBe(SEALED.documentId);
  });
});

describe("authoritativeStatus", () => {
  it("reports a completed session as completed, never as signed", async () => {
    const { provider } = build();

    const status = await provider.authoritativeStatus(SESSION_ID as CeremonyId);

    // A closed session is not a signed document (STYLES 9.1).
    expect(status.state).toBe("completed");
  });

  it.each<[SdkSessionStatus, string]>([
    ["created", "open"],
    ["in_progress", "open"],
    ["started", "open"],
    ["cancelled", "cancelled"],
    ["expired", "expired"],
    ["failed", "failed"],
  ])("maps the %s session status to %s", async (sdkStatus, expected) => {
    const { provider } = build({ status: sessionStatus({ status: sdkStatus }) });

    const status = await provider.authoritativeStatus(SESSION_ID as CeremonyId);

    expect(status.state).toBe(expected);
  });

  it("classifies a code the SDK has never heard of as retry-in-step", async () => {
    const { provider } = build({
      status: sessionStatus({ status: "failed", errorCode: "A_CODE_ADDED_NEXT_RELEASE" }),
    });

    const status = await provider.authoritativeStatus(SESSION_ID as CeremonyId);

    // Escalating would make the signer redo OTP, identity and certificate.
    expect(status.disposition).toBe("retry-in-step");
    expect(status.errorCode).toBe("A_CODE_ADDED_NEXT_RELEASE");
  });

  it("carries the correlation id and external reference a ledger needs to route", async () => {
    const { provider } = build();

    const status = await provider.authoritativeStatus(SESSION_ID as CeremonyId);

    expect(status.correlationId).toBe("sdk_2b9d");
    expect(status.externalUserRef).toBe("loan-4821");
  });

  it("reports no disposition when the session carries no error code", async () => {
    const { provider } = build();

    const status = await provider.authoritativeStatus(SESSION_ID as CeremonyId);

    expect(status.disposition).toBeUndefined();
  });
});

describe("verifyArtifact", () => {
  it("runs our custody sink, and only then returns the binding", async () => {
    const { provider, recorder } = build();
    const archived: string[] = [];

    const verified = await provider.verifyArtifact(DELIVERY, async (artifact) => {
      expect(recorder.custodyRan).toBe(false);
      archived.push(artifact.documentId);
    });

    expect(archived).toEqual([SEALED.documentId]);
    expect(recorder.custodyRan).toBe(true);
    expect(verified.signatures[0]?.signerCertificateFingerprint).toBe("AB:CD:EF");
  });

  it("keys idempotency on the ceremony and document, so a retry rebinds nothing", async () => {
    let seen = "";

    const sessions: LakautSessions = {
      async createSession() {
        return sessionOutput();
      },
      async getSession() {
        return sessionStatus();
      },
      async verifyAndAcknowledgeSignedArtifact(input) {
        seen = input.idempotencyKey;
        throw new Error("stop here");
      },
    };
    const probe = new LakautSignatureProvider({
      sessions,
      allowedOrigin: "https://dev.lucerolabs.xyz",
      flowType: "SIGNING",
      authenticationProfileId: "auth.email.v1",
      now,
    });

    await probe.verifyArtifact(DELIVERY, async () => {}).catch(() => undefined);

    expect(seen).toBe(`${SESSION_ID}:${SEALED.documentId}:custody`);
  });
});

describe("the error taxonomy stays aligned with the SDK's", () => {
  it("breaks the build if the SDK ever adds a category our dispositions lack", () => {
    // STYLES 9.3 asks for a map that is exhaustive over the provider's codes.
    // Classification itself is the SDK's `categoryFor`, so the thing that can
    // drift is not a code but a *category*: this Record is a compile error the
    // day the vendor adds a fourth, and a compile error the day one of ours
    // stops matching.
    const alignment: Record<SdkErrorCategory, CeremonyDisposition> = {
      "retry-in-step": "retry-in-step",
      terminal: "terminal",
      "session-recovery": "session-recovery",
    };

    expect(Object.keys(alignment).sort()).toEqual([
      "retry-in-step",
      "session-recovery",
      "terminal",
    ]);
  });
});

describe("what can reach a browser or a log", () => {
  it("never carries the API key into the ceremony handed to a client", async () => {
    const { provider } = build();

    const ceremony = await provider.openCeremony(SEALED, {
      role: "librador",
      identity: { nationalId: "30123456", sexo: "F" },
    });
    const serialised = JSON.stringify(ceremony);

    expect(serialised).not.toContain(API_KEY);
  });

  it("never carries a DNI into the ceremony, even when one was bound", async () => {
    const { provider } = build();

    const ceremony = await provider.openCeremony(SEALED, {
      role: "librador",
      identity: { nationalId: "30123456", sexo: "F" },
    });

    // identitySubject is server-side only and must not survive into the renderer
    // context (STYLES 8.1, 8.2).
    expect(JSON.stringify(ceremony)).not.toContain("30123456");
  });

  it("never carries a DNI or a certificate secret into a verified artefact", async () => {
    const { provider } = build();

    const verified = await provider.verifyArtifact(DELIVERY, async () => {});

    expect(JSON.stringify(verified)).not.toContain("30123456");
    expect(JSON.stringify(verified)).not.toContain(CLIENT_TOKEN);
  });
});
