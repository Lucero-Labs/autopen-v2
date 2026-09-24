import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Ceremony,
  type CeremonyId,
  type CeremonyPlan,
  type CeremonyState,
  type CeremonyStatus,
  type CustodySink,
  DefaultSigningCore,
  InMemoryCeremonyLedger,
  InMemoryDocumentStore,
  type SealedDocument,
  type SignatureProvider,
  type SignedDelivery,
  type SignerRole,
  type VerifiedArtifact,
} from "@autopen/core";
import type { SigningEligibility } from "@autopen/adapter-lakaut";

import type { EvidenceStore } from "../src/evidence.ts";
import { probeDatabase } from "../src/health.ts";
import { cryptoInstrumentIds, InMemoryInstrumentStore } from "../src/instruments.ts";
import { createRouter, type RouterDependencies } from "../src/routes.ts";
import type {
  ErrorResponse,
  HandoffResponse,
  HealthResponse,
  InstrumentResponse,
  StatusResponse,
} from "../src/wire.ts";
import { DETAIL_LINES, STATUS_LINES } from "../web/status-lines.ts";

const AT = new Date("2026-09-24T12:00:00.000Z");
const ALLOWED_ORIGIN = "https://demo.example.invalid";
const HOSTED_UI_ORIGIN = "https://hosted-ui.example.invalid";
const SIGNER_EMAIL = "firmante@example.invalid";
const SIGNER_PHONE = "+5491100000000";
const CLIENT_TOKEN = "client-token-never-logged";
const API_KEY = "test-api-key-never-logged-0123456789abcdef";
const DATABASE_PASSWORD = "database-password-never-logged";

const ELIGIBLE: SigningEligibility = Object.freeze({
  decision: "READY_FOR_SIGNING",
  journey: "signing",
  nextAction: "CREATE_SESSION",
  checkedAt: AT.toISOString(),
  validUntil: AT.toISOString(),
  correlationId: "sdk_eligible",
});

const NOT_ELIGIBLE: SigningEligibility = Object.freeze({
  decision: "ONBOARDING_REQUIRED",
  journey: "onboarding-and-signing",
  nextAction: "CREATE_SESSION",
  checkedAt: AT.toISOString(),
  validUntil: AT.toISOString(),
  correlationId: "sdk_onboarding",
});

/** Records what the router asked of the provider, and answers however a test needs. */
class FakeProvider implements SignatureProvider {
  readonly opened: {
    readonly document: SealedDocument;
    readonly signer: SignerRole;
    readonly plan: CeremonyPlan;
  }[] = [];
  readonly statusCalls: CeremonyId[] = [];
  nextState: CeremonyState = "open";
  nextErrorCode: string | undefined;
  statusThrows: Error | undefined;
  hostedUiOrigin = HOSTED_UI_ORIGIN;

  async openCeremony(
    document: SealedDocument,
    signer: SignerRole,
    plan: CeremonyPlan,
  ): Promise<Ceremony> {
    // A real provider answers over the network; yielding once makes two
    // concurrent callers actually overlap here rather than serialise by luck.
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.opened.push({ document, signer, plan });
    return {
      ceremonyId: `session-${this.opened.length}` as CeremonyId,
      documentId: document.documentId,
      handoff: {
        provider: "fake",
        context: {
          sessionId: `session-${this.opened.length}`,
          clientToken: CLIENT_TOKEN,
          hostedUiOrigin: this.hostedUiOrigin,
          allowedOrigin: ALLOWED_ORIGIN,
        },
      },
      openedAt: AT.toISOString(),
    };
  }

  async authoritativeStatus(ceremonyId: CeremonyId): Promise<CeremonyStatus> {
    this.statusCalls.push(ceremonyId);
    if (this.statusThrows !== undefined) throw this.statusThrows;
    return {
      ceremonyId,
      state: this.nextState,
      ...(this.nextErrorCode !== undefined
        ? { errorCode: this.nextErrorCode, disposition: "terminal" as const }
        : {}),
      externalUserRef: null,
      correlationId: "sdk_status",
      observedAt: AT.toISOString(),
    };
  }

  async verifyArtifact(delivery: SignedDelivery, custody: CustodySink): Promise<VerifiedArtifact> {
    const artifact: VerifiedArtifact = {
      documentId: delivery.documentId,
      signedContentHash: delivery.signedContentHash,
      finalPdfHash: delivery.finalPdfHash,
      bytes: delivery.bytes,
      signatures: [],
      verifiedAt: AT.toISOString(),
    };
    await custody(artifact);
    return artifact;
  }
}

/** Custody in an array: what was archived is what the artifact route can read back. */
class InMemoryEvidenceStore implements EvidenceStore {
  readonly archived: VerifiedArtifact[] = [];

  async archive(artifact: VerifiedArtifact): Promise<void> {
    await Promise.resolve();
    this.archived.push(artifact);
  }

  async readArtifact(documentId: string): Promise<Uint8Array | undefined> {
    await Promise.resolve();
    return this.archived.find((artifact) => artifact.documentId === documentId)?.bytes;
  }
}

interface Harness {
  readonly base: string;
  readonly provider: FakeProvider;
  readonly eligibility: { calls: number; answer: SigningEligibility };
  readonly archived: VerifiedArtifact[];
  readonly database: { url: string | undefined; probes: number };
  readonly clock: { now: Date };
  readonly server: Server;
}

async function start(): Promise<Harness> {
  const provider = new FakeProvider();
  const eligibility = { calls: 0, answer: ELIGIBLE };
  const evidence = new InMemoryEvidenceStore();
  const database: { url: string | undefined; probes: number } = { url: undefined, probes: 0 };
  const clock = { now: AT };
  const documents = new InMemoryDocumentStore();
  const ceremonies = new InMemoryCeremonyLedger();

  const webRoot = await mkdtemp(join(tmpdir(), "signing-service-"));
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>issuer</title>");
  await writeFile(join(webRoot, "sign.html"), "<!doctype html><title>sign</title>");

  const deps: RouterDependencies = {
    core: new DefaultSigningCore({
      provider,
      documents,
      ceremonies,
      now: () => AT,
      maxDocumentBytes: 1_000_000,
    }),
    checkEligibility: async () => {
      eligibility.calls += 1;
      return eligibility.answer;
    },
    instruments: new InMemoryInstrumentStore(),
    documents,
    ceremonies,
    evidence,
    ids: cryptoInstrumentIds,
    allowedOrigin: ALLOWED_ORIGIN,
    hostedUiOrigin: HOSTED_UI_ORIGIN,
    webhookSecret: undefined,
    webRoot,
    apiKey: API_KEY,
    environment: "sandbox",
    database: () => {
      database.probes += 1;
      return probeDatabase(database.url, { timeoutMs: 2_000 });
    },
    now: () => clock.now,
  };

  const server = createServer(createRouter(deps));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    base: `http://127.0.0.1:${port}`,
    provider,
    eligibility,
    archived: evidence.archived,
    database,
    clock,
    server,
  };
}

/** How a call authenticates: the right key unless a test says otherwise. */
type Auth = "none" | { readonly bearer: string } | { readonly header: string };

function authorization(auth: Auth): Record<string, string> {
  if (auth === "none") return {};
  return "bearer" in auth
    ? { authorization: `Bearer ${auth.bearer}` }
    : { authorization: auth.header };
}

async function call(
  harness: Harness,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  auth: Auth = { bearer: API_KEY },
): Promise<{ readonly status: number; readonly headers: Headers; readonly json: unknown }> {
  const response = await fetch(`${harness.base}${path}`, {
    method,
    headers: {
      ...authorization(auth),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, headers: response.headers, json };
}

function instrumentBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    email: SIGNER_EMAIL,
    phone: SIGNER_PHONE,
    reference: "ar.pagare/test-1",
    montoCentavos: 190000000,
    ...overrides,
  };
}

async function createInstrument(
  harness: Harness,
  overrides: Record<string, unknown> = {},
): Promise<{
  readonly status: number;
  readonly created: InstrumentResponse;
  readonly token: string;
}> {
  const { status, json } = await call(
    harness,
    "POST",
    "/api/instruments",
    instrumentBody(overrides),
  );
  const created = json as InstrumentResponse;
  const token = created.signingUrl.slice(`${ALLOWED_ORIGIN}/sign/`.length);
  return { status, created, token };
}

async function handoff(harness: Harness, token: string): Promise<HandoffResponse> {
  const { status, json } = await call(harness, "POST", `/api/sign/${token}/handoff`);
  expect(status).toBe(200);
  const payload = json as HandoffResponse | StatusResponse;
  if (!("handoff" in payload)) throw new Error(`expected a handoff, got state ${payload.state}`);
  return payload;
}

function deliveryFor(opened: HandoffResponse, overrides: Record<string, unknown> = {}) {
  return {
    ceremonyId: opened.ceremonyId,
    documentId: opened.document.documentId,
    fileName: opened.fileName,
    bytesBase64: opened.document.bytesBase64,
    signedContentHash: "a".repeat(64),
    finalPdfHash: "b".repeat(64),
    signedAt: AT.toISOString(),
    ...overrides,
  };
}

let harness: Harness;
let logged: string[];
let errored: string[];

/** Node's own console renders objects with `util.inspect`; capturing with `String` would hide a leaked object as `[object Object]`. */
function render(parts: unknown[]): string {
  return parts
    .map((part) => (typeof part === "string" ? part : inspect(part, { depth: null })))
    .join(" ");
}

beforeEach(async () => {
  logged = [];
  errored = [];
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    logged.push(render(parts));
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    errored.push(render(parts));
  });
  harness = await start();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) =>
    harness.server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
});

function everythingLogged(): string {
  return [...logged, ...errored].join("\n");
}

describe("POST /api/instruments", () => {
  it("returns a link whose token is 43 characters of base64url and appears in no log line", async () => {
    const { status, created, token } = await createInstrument(harness);

    expect(status).toBe(201);
    expect(created.signingUrl).toBe(`${ALLOWED_ORIGIN}/sign/${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(everythingLogged()).toContain(`instrumentId=${created.instrumentId}`);
    expect(everythingLogged()).not.toContain(token);
    expect(everythingLogged()).not.toContain(SIGNER_EMAIL);
  });

  it("returns the existing instrument for the same reference and the same bytes", async () => {
    const first = await createInstrument(harness);
    const second = await createInstrument(harness);

    expect(second.status).toBe(200);
    expect(second.created).toEqual(first.created);
  });

  it("makes one instrument when the same reference is posted twice at once", async () => {
    const [first, second] = await Promise.all([
      createInstrument(harness),
      createInstrument(harness),
    ]);

    expect(first.created.signingUrl).toBe(second.created.signingUrl);
    expect(first.created.instrumentId).toBe(second.created.instrumentId);
    expect(logged.filter((line) => line.startsWith("instrument created"))).toHaveLength(1);
  });

  it("refuses the same reference with different bytes rather than re-linking it", async () => {
    await createInstrument(harness);
    const { status, json } = await call(
      harness,
      "POST",
      "/api/instruments",
      instrumentBody({ montoCentavos: 1 }),
    );

    expect(status).toBe(409);
    expect(json).toEqual({
      error: "reference ar.pagare/test-1 already names a different document",
    });
  });

  it("ignores a journey the issuer tries to choose: the plan comes from eligibility", async () => {
    harness.eligibility.answer = NOT_ELIGIBLE;
    const { status, token } = await createInstrument(harness, {
      journey: "signing",
      factors: "email",
    });
    await handoff(harness, token);

    expect(status).toBe(201);
    expect(harness.provider.opened.map((opened) => opened.plan)).toEqual([
      { journey: "onboarding-and-signing", factors: "email-and-sms" },
    ]);
  });

  it("refuses a body without an email", async () => {
    const { status, json } = await call(harness, "POST", "/api/instruments", {
      reference: "ar.pagare/test-2",
      montoCentavos: 100,
    });

    expect(status).toBe(400);
    expect(json).toEqual({ error: "email must be a non-empty string" });
  });
});

describe("POST /api/sign/{token}/handoff", () => {
  it("answers 404 for an unknown token and writes nothing about it", async () => {
    const { status, json } = await call(harness, "POST", "/api/sign/not-a-real-token/handoff");

    expect(status).toBe(404);
    expect(json).toEqual({ error: "no such instrument" });
    expect(everythingLogged()).not.toContain("not-a-real-token");
    expect(harness.provider.opened).toHaveLength(0);
  });

  it("opens signing over email when the signer already holds a certificate", async () => {
    harness.eligibility.answer = ELIGIBLE;
    const { token } = await createInstrument(harness);

    const payload = await handoff(harness, token);

    expect(harness.provider.opened.map((opened) => opened.plan)).toEqual([
      { journey: "signing", factors: "email" },
    ]);
    expect(harness.provider.opened[0]?.signer).toEqual({
      role: "librador",
      email: SIGNER_EMAIL,
      phone: SIGNER_PHONE,
      externalUserRef: "ar.pagare/test-1",
    });
    expect(payload.state).toBe("awaiting-signature");
    expect(payload.ceremonyId).toBe("session-1");
    expect(payload.fileName).toBe("ar.pagare-test-1.pdf");
    expect(payload.handoff.context.hostedUiOrigin).toBe(HOSTED_UI_ORIGIN);
    expect(payload.document.bytesBase64.length).toBeGreaterThan(0);
    expect(logged.join("\n")).toContain("journey=signing factors=email sessionId=session-1");
  });

  it("opens onboarding over email and sms when the signer holds no certificate", async () => {
    harness.eligibility.answer = NOT_ELIGIBLE;
    const { token } = await createInstrument(harness);

    await handoff(harness, token);

    expect(harness.provider.opened.map((opened) => opened.plan)).toEqual([
      { journey: "onboarding-and-signing", factors: "email-and-sms" },
    ]);
  });

  it("refuses onboarding without a phone and opens nothing", async () => {
    harness.eligibility.answer = NOT_ELIGIBLE;
    const { token } = await createInstrument(harness, { phone: undefined });

    const { status, json } = await call(harness, "POST", `/api/sign/${token}/handoff`);

    expect(status).toBe(409);
    expect(json).toEqual({
      error:
        "the signer holds no certificate, and onboarding needs a phone: " +
        "create the instrument again with one",
    });
    expect(harness.provider.opened).toHaveLength(0);
  });

  it("opens nothing when the provider recommends no journey", async () => {
    harness.eligibility.answer = {
      decision: "CERTIFICATE_PREPARING",
      nextAction: "RETRY",
      retryAfterSeconds: 30,
      checkedAt: AT.toISOString(),
      validUntil: AT.toISOString(),
      correlationId: "sdk_preparing",
    };
    const { token } = await createInstrument(harness);

    const { status, json } = await call(harness, "POST", `/api/sign/${token}/handoff`);

    expect(status).toBe(409);
    expect(json).toEqual({
      error: "the provider recommends no journey yet (CERTIFICATE_PREPARING); retry in 30s",
    });
    expect(harness.provider.opened).toHaveLength(0);
  });

  it("returns the same ceremony on a second handoff without opening again", async () => {
    const { token } = await createInstrument(harness);

    const first = await handoff(harness, token);
    const second = await handoff(harness, token);

    expect(second).toEqual(first);
    expect(harness.provider.opened).toHaveLength(1);
    expect(harness.eligibility.calls).toBe(1);
  });

  it("opens one session when the same link is opened twice at once", async () => {
    const { token } = await createInstrument(harness);

    const [first, second] = await Promise.all([handoff(harness, token), handoff(harness, token)]);

    expect(harness.provider.opened).toHaveLength(1);
    expect(harness.eligibility.calls).toBe(1);
    expect(first.ceremonyId).toBe("session-1");
    expect(second.ceremonyId).toBe("session-1");
  });

  it("reconciles an existing ceremony first and hands nothing off once it is cancelled, expired or failed", async () => {
    const { token } = await createInstrument(harness);
    await handoff(harness, token);

    harness.provider.nextState = "expired";
    const { status, json } = await call(harness, "POST", `/api/sign/${token}/handoff`);

    expect(status).toBe(200);
    expect(json).toEqual({
      state: "expired",
      ceremony: { state: "expired", correlationId: "sdk_status" },
    });
    expect(harness.provider.statusCalls).toEqual(["session-1"]);
    expect(harness.provider.opened).toHaveLength(1);
  });

  it("refuses a handoff whose Hosted UI origin is not the one the page allows, naming both only in the log", async () => {
    harness.provider.hostedUiOrigin = "https://somewhere-else.example.invalid";
    const { token } = await createInstrument(harness);

    const { status, json } = await call(harness, "POST", `/api/sign/${token}/handoff`);

    expect(status).toBe(500);
    expect(json).toEqual({ error: "error interno" });
    expect(errored).toEqual([
      "POST /api/sign/…/handoff -> 500 the session's Hosted UI origin is " +
        `https://somewhere-else.example.invalid but LAKAUT_HOSTED_UI_ORIGIN is ${HOSTED_UI_ORIGIN}`,
    ]);
    expect(everythingLogged()).not.toContain(token);
  });

  it("hands a 500 the provider's correlationId and nothing else", async () => {
    const { token } = await createInstrument(harness);
    await handoff(harness, token);
    harness.provider.statusThrows = Object.assign(new Error("UPSTREAM_UNAVAILABLE at /internal"), {
      correlationId: "sdk_failed",
    });

    const { status, json } = await call(harness, "POST", `/api/sign/${token}/handoff`);

    expect(status).toBe(500);
    expect(json).toEqual({ error: "error interno", correlationId: "sdk_failed" });
    expect(errored.join("\n")).toContain("UPSTREAM_UNAVAILABLE at /internal");
  });
});

describe("GET /api/sign/{token}/status", () => {
  it("is awaiting-signature before any ceremony exists, without reading the provider", async () => {
    const { token } = await createInstrument(harness);

    const { status, json } = await call(harness, "GET", `/api/sign/${token}/status`);

    expect(status).toBe(200);
    expect(json).toEqual({ state: "awaiting-signature" });
    expect(harness.provider.statusCalls).toHaveLength(0);
  });

  it("maps the provider's reconciled state, and a completed session is not signed", async () => {
    const { token } = await createInstrument(harness);
    await handoff(harness, token);

    harness.provider.nextState = "completed";
    const completed = await call(harness, "GET", `/api/sign/${token}/status`);
    expect(completed.json).toEqual({
      state: "awaiting-delivery",
      ceremony: { state: "completed", correlationId: "sdk_status" },
    });

    harness.provider.nextState = "failed";
    harness.provider.nextErrorCode = "SIGN_PIN_RATE_LIMITED";
    const failed = await call(harness, "GET", `/api/sign/${token}/status`);
    expect(failed.json).toEqual({
      state: "failed",
      ceremony: {
        state: "failed",
        errorCode: "SIGN_PIN_RATE_LIMITED",
        disposition: "terminal",
        correlationId: "sdk_status",
      },
    });
    expect(harness.provider.statusCalls).toEqual(["session-1", "session-1"]);
  });

  it("redacts the token and drops the query string from the error line when the provider read fails", async () => {
    const { token } = await createInstrument(harness);
    await handoff(harness, token);
    harness.provider.statusThrows = new Error("UPSTREAM_UNAVAILABLE");

    const { status } = await call(harness, "GET", `/api/sign/${token}/status?debug=secret-query`);

    expect(status).toBe(500);
    expect(errored).toEqual(["GET /api/sign/…/status -> 500 UPSTREAM_UNAVAILABLE"]);
  });
});

describe("POST /api/sign/{token}/deliveries", () => {
  it("refuses a delivery naming a document other than the ceremony's, before the core sees it", async () => {
    const { token } = await createInstrument(harness);
    const opened = await handoff(harness, token);

    const { status, json } = await call(
      harness,
      "POST",
      `/api/sign/${token}/deliveries`,
      deliveryFor(opened, { documentId: "some-other-document" }),
    );

    expect(status).toBe(409);
    expect(json).toEqual({
      error:
        `ceremony session-1 was opened for document ${opened.document.documentId}, ` +
        "not some-other-document",
    });
    expect(harness.archived).toHaveLength(0);
    expect((await call(harness, "GET", `/api/sign/${token}/status`)).json).toMatchObject({
      state: "awaiting-signature",
    });
  });

  it("refuses a delivery whose ceremony belongs to another instrument, and archives nothing", async () => {
    const first = await createInstrument(harness);
    const firstOpened = await handoff(harness, first.token);
    const second = await createInstrument(harness, { reference: "ar.pagare/test-2" });
    await handoff(harness, second.token);

    // The second link, carrying the first instrument's ceremony and document.
    const { status, json } = await call(
      harness,
      "POST",
      `/api/sign/${second.token}/deliveries`,
      deliveryFor(firstOpened),
    );

    expect(status).toBe(409);
    expect(json).toEqual({ error: "ceremony session-1 does not belong to this instrument" });
    expect(harness.archived).toHaveLength(0);
    expect((await call(harness, "GET", `/api/sign/${first.token}/status`)).json).toMatchObject({
      state: "awaiting-signature",
    });
  });

  it("refuses a delivery before any ceremony was opened for the link", async () => {
    const { token } = await createInstrument(harness);
    const other = await createInstrument(harness, { reference: "ar.pagare/test-2" });
    const opened = await handoff(harness, other.token);

    const { status } = await call(
      harness,
      "POST",
      `/api/sign/${token}/deliveries`,
      deliveryFor(opened),
    );

    expect(status).toBe(409);
    expect(harness.archived).toHaveLength(0);
  });

  it("answers 405, not 401, to the wrong verb on a signing route the token does open", async () => {
    const { token } = await createInstrument(harness);

    const getHandoff = await call(harness, "GET", `/api/sign/${token}/handoff`, undefined, "none");
    const postStatus = await call(harness, "POST", `/api/sign/${token}/status`, undefined, "none");
    const getDeliveries = await call(
      harness,
      "GET",
      `/api/sign/${token}/deliveries`,
      undefined,
      "none",
    );

    for (const answer of [getHandoff, postStatus, getDeliveries]) {
      expect(answer.status).toBe(405);
      expect(answer.json).toEqual({ error: "method not allowed" });
    }
    expect(errored).toEqual([]);
    expect(harness.provider.opened).toHaveLength(0);
  });

  it("answers 404 for an unknown token, without reading the body", async () => {
    const { status, json } = await call(harness, "POST", "/api/sign/not-a-real-token/deliveries", {
      ceremonyId: "session-1",
    });

    expect(status).toBe(404);
    expect(json).toEqual({ error: "no such instrument" });
    expect(everythingLogged()).not.toContain("not-a-real-token");
  });

  it("refuses a fileName over the vendor's 180-character cap", async () => {
    const { token } = await createInstrument(harness);
    const opened = await handoff(harness, token);

    const { status, json } = await call(
      harness,
      "POST",
      `/api/sign/${token}/deliveries`,
      deliveryFor(opened, { fileName: `${"x".repeat(181)}.pdf` }),
    );

    expect(status).toBe(400);
    expect(json).toEqual({ error: "fileName must be at most 180 characters" });
  });

  it("refuses a body larger than a signed PDF could be, before buffering it", async () => {
    const { token } = await createInstrument(harness);
    const opened = await handoff(harness, token);
    const tooLarge = JSON.stringify(
      deliveryFor(opened, { bytesBase64: "A".repeat(30 * 1024 * 1024) }),
    );

    const { status, json } = await call(harness, "POST", `/api/sign/${token}/deliveries`, tooLarge);

    expect(status).toBe(413);
    expect((json as ErrorResponse).error).toMatch(/^body must be at most \d+ bytes$/);
    expect(harness.archived).toHaveLength(0);
  });
});

describe("the product API key", () => {
  it("refuses a request with no bearer: 401, a one-word body, and a log line naming only the route", async () => {
    const { status, json } = await call(
      harness,
      "POST",
      "/api/instruments",
      instrumentBody(),
      "none",
    );

    expect(status).toBe(401);
    expect(json).toEqual({ error: "unauthorized" });
    expect(errored).toEqual(["401 POST /api/instruments"]);
    expect(harness.provider.opened).toHaveLength(0);
  });

  it("refuses a wrong key of the same length", async () => {
    const wrong = API_KEY.replace(/.$/, (last) => (last === "f" ? "0" : "f"));
    expect(wrong).toHaveLength(API_KEY.length);

    const { status, json } = await call(harness, "POST", "/api/instruments", instrumentBody(), {
      bearer: wrong,
    });

    expect(status).toBe(401);
    expect(json).toEqual({ error: "unauthorized" });
  });

  it("refuses a wrong key of a different length without throwing", async () => {
    const shorter = await call(harness, "POST", "/api/instruments", instrumentBody(), {
      bearer: "short",
    });
    const longer = await call(harness, "POST", "/api/instruments", instrumentBody(), {
      bearer: `${API_KEY}-and-more`,
    });

    expect(shorter.status).toBe(401);
    expect(longer.status).toBe(401);
    expect(errored).toEqual(["401 POST /api/instruments", "401 POST /api/instruments"]);
  });

  it("refuses a malformed Authorization header", async () => {
    for (const header of [
      "Basic dXNlcjpwYXNz",
      `Token ${API_KEY}`,
      "Bearer",
      `Bearer ${API_KEY} x`,
    ]) {
      const { status } = await call(harness, "POST", "/api/eligibility", instrumentBody(), {
        header,
      });
      expect(status).toBe(401);
    }
    expect(harness.eligibility.calls).toBe(0);
  });

  it("runs the route with the right key, and the key appears in no log line either way", async () => {
    await call(harness, "POST", "/api/instruments", instrumentBody(), "none");
    const { status, token } = await createInstrument(harness);

    expect(status).toBe(201);
    expect(everythingLogged()).not.toContain(API_KEY);
    expect(everythingLogged()).not.toContain(token);
  });

  it("guards eligibility and every GET under /api/instruments/, and redacts nothing it need not", async () => {
    const { created } = await createInstrument(harness);

    for (const [method, path] of [
      ["POST", "/api/eligibility"],
      ["GET", `/api/instruments/${created.instrumentId}`],
      ["GET", `/api/instruments/${created.instrumentId}/document`],
      ["GET", `/api/instruments/${created.instrumentId}/artifact`],
    ] as const) {
      errored = [];
      const { status } = await call(harness, method, path, undefined, "none");
      expect(status).toBe(401);
      expect(errored).toEqual([`401 ${method} ${path}`]);
    }
  });

  it("asks nothing of the pages, the signing routes, the webhook or the health check", async () => {
    const { token } = await createInstrument(harness);

    expect((await call(harness, "GET", "/", undefined, "none")).status).toBe(200);
    expect((await call(harness, "GET", `/sign/${token}`, undefined, "none")).status).toBe(200);
    expect((await call(harness, "GET", "/health", undefined, "none")).status).toBe(200);
    expect(
      (await call(harness, "GET", `/api/sign/${token}/status`, undefined, "none")).json,
    ).toEqual({ state: "awaiting-signature" });
    expect(
      (await call(harness, "POST", `/api/sign/${token}/handoff`, undefined, "none")).status,
    ).toBe(200);
    // No secret is configured, so the webhook fails closed with 503 — not 401.
    expect((await call(harness, "POST", "/api/webhooks/lakaut", "{}", "none")).status).toBe(503);
    expect(errored.filter((line) => line.startsWith("401"))).toEqual([]);
  });
});

describe("GET /api/instruments/{id}", () => {
  it("returns the instrument as the product sees it, with the same link and no token elsewhere", async () => {
    const { created } = await createInstrument(harness);

    const { status, json } = await call(harness, "GET", `/api/instruments/${created.instrumentId}`);

    expect(status).toBe(200);
    expect(json).toEqual({
      instrumentId: created.instrumentId,
      reference: "ar.pagare/test-1",
      documentId: created.documentId,
      state: "awaiting-signature",
      signingUrl: created.signingUrl,
    } satisfies InstrumentResponse);
  });

  it("answers 404 for an id nobody minted", async () => {
    const { status, json } = await call(harness, "GET", "/api/instruments/not-an-id");

    expect(status).toBe(404);
    expect(json).toEqual({ error: "no such instrument" });
  });

  it("serves the sealed PDF under /document", async () => {
    const { created } = await createInstrument(harness);

    const response = await fetch(
      `${harness.base}/api/instruments/${created.instrumentId}/document`,
      { headers: authorization({ bearer: API_KEY }) },
    );
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("serves the signed PDF under /artifact only once a verified copy is in custody", async () => {
    const { created, token } = await createInstrument(harness);
    const opened = await handoff(harness, token);
    const artifactUrl = `${harness.base}/api/instruments/${created.instrumentId}/artifact`;
    const headers = authorization({ bearer: API_KEY });

    const before = await fetch(artifactUrl, { headers });
    expect(before.status).toBe(404);
    expect(await before.json()).toEqual({ error: "not signed yet" });

    const signedBytes = Buffer.from("%PDF-1.7 signed copy");
    await call(
      harness,
      "POST",
      `/api/sign/${token}/deliveries`,
      deliveryFor(opened, { bytesBase64: signedBytes.toString("base64") }),
    );

    const after = await fetch(artifactUrl, { headers });
    expect(after.status).toBe(200);
    expect(after.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await after.arrayBuffer())).toEqual(signedBytes);
    expect(
      (await call(harness, "GET", `/api/instruments/${created.instrumentId}`)).json,
    ).toMatchObject({ state: "signed" });
  });
});

describe("GET /health", () => {
  it("probes the database once per ten-second window, however many requests arrive", async () => {
    harness.database.url = "postgres://app:not-a-real-password@127.0.0.1:1/app";

    await Promise.all([
      call(harness, "GET", "/health", undefined, "none"),
      call(harness, "GET", "/health", undefined, "none"),
    ]);
    await call(harness, "GET", "/health", undefined, "none");
    expect(harness.database.probes).toBe(1);

    harness.clock.now = new Date(AT.getTime() + 9_999);
    await call(harness, "GET", "/health", undefined, "none");
    expect(harness.database.probes).toBe(1);

    harness.clock.now = new Date(AT.getTime() + 10_000);
    const { json } = await call(harness, "GET", "/health", undefined, "none");
    expect(harness.database.probes).toBe(2);
    expect(json).toMatchObject({ ok: true, database: "unreachable" });
  });

  it("reports the environment and an unconfigured database when there is no URL", async () => {
    const { status, json } = await call(harness, "GET", "/health", undefined, "none");

    expect(status).toBe(200);
    expect(json).toEqual({
      ok: true,
      environment: "sandbox",
      database: "unconfigured",
    } satisfies HealthResponse);
  });

  it("reports unreachable for a closed port, and reachable for an open one, naming neither", async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const closed = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve, reject) =>
      probe.close((error) => (error === undefined ? resolve() : reject(error))),
    );
    harness.database.url = `postgres://app:${DATABASE_PASSWORD}@127.0.0.1:${closed}/app`;

    const unreachable = await call(harness, "GET", "/health", undefined, "none");
    expect(unreachable.json).toMatchObject({ ok: true, database: "unreachable" });

    // The harness's own listener accepts TCP; that is all the probe asks. The
    // clock moves past the window first, or the cached answer would be reused.
    const open = new URL(harness.base).port;
    harness.database.url = `postgres://app:${DATABASE_PASSWORD}@127.0.0.1:${open}/app`;
    harness.clock.now = new Date(AT.getTime() + 10_000);

    const reachable = await call(harness, "GET", "/health", undefined, "none");
    expect(reachable.json).toMatchObject({ ok: true, database: "reachable" });

    expect(JSON.stringify([unreachable.json, reachable.json])).not.toContain(DATABASE_PASSWORD);
    expect(everythingLogged()).not.toContain(DATABASE_PASSWORD);
    expect(everythingLogged()).not.toContain("127.0.0.1");
  });
});

describe("GET /sign/{token}", () => {
  it("serves the signing page with the Hosted UI origin allow-listed for frames, camera and microphone, and no referrer", async () => {
    const { status, headers, json } = await call(harness, "GET", "/sign/whatever-the-token-is");

    expect(status).toBe(200);
    expect(json).toContain("<title>sign</title>");
    expect(headers.get("content-security-policy")).toBe(
      `frame-src 'self' ${HOSTED_UI_ORIGIN}; child-src 'self' ${HOSTED_UI_ORIGIN}`,
    );
    expect(headers.get("permissions-policy")).toBe(
      `camera=(self "${HOSTED_UI_ORIGIN}"), microphone=(self "${HOSTED_UI_ORIGIN}")`,
    );
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("cache-control")).toBe("no-store");
  });

  it("leaves the issuer's page without those headers", async () => {
    const { status, headers, json } = await call(harness, "GET", "/");

    expect(status).toBe(200);
    expect(json).toContain("<title>issuer</title>");
    expect(headers.get("content-security-policy")).toBeNull();
    expect(headers.get("permissions-policy")).toBeNull();
    expect(headers.get("referrer-policy")).toBeNull();
  });
});

describe("create → handoff → deliver", () => {
  it("marks the instrument signed only after custody, and logs ids but nothing secret", async () => {
    const { created, token } = await createInstrument(harness);
    const opened = await handoff(harness, token);
    const { documentId, bytesBase64 } = opened.document;

    const delivered = await call(
      harness,
      "POST",
      `/api/sign/${token}/deliveries`,
      deliveryFor(opened),
    );

    expect(delivered.status).toBe(200);
    expect(delivered.json).toEqual({
      documentId,
      verifiedAt: AT.toISOString(),
    });
    expect(harness.archived.map((artifact) => artifact.documentId)).toEqual([documentId]);

    expect((await call(harness, "GET", `/api/sign/${token}/status`)).json).toEqual({
      state: "signed",
    });
    expect((await call(harness, "POST", `/api/sign/${token}/handoff`)).json).toEqual({
      state: "signed",
    });
    // Signed is a fact about custody, not about the provider: no further read.
    expect(harness.provider.statusCalls).toHaveLength(0);

    const output = everythingLogged();
    expect(output).toContain(`documentId=${documentId}`);
    expect(output).toContain("sessionId=session-1");
    expect(output).toContain(`instrumentId=${created.instrumentId}`);
    expect(output).not.toContain(token);
    expect(output).not.toContain(CLIENT_TOKEN);
    expect(output).not.toContain(API_KEY);
    expect(output).not.toContain("hostedUiOrigin");
    expect(output).not.toContain(SIGNER_EMAIL);
    expect(output).not.toContain(SIGNER_PHONE);
    expect(output).not.toContain(bytesBase64);
    expect(output).not.toContain("%PDF");
  });

  it("would catch a logged object, not only a logged string", () => {
    console.log("handoff", { context: { clientToken: CLIENT_TOKEN } });

    expect(everythingLogged()).toContain(CLIENT_TOKEN);
  });
});

describe("the signing page's lines", () => {
  it("are the Spanish sentences the signer reads, exported from one frozen module", () => {
    expect(STATUS_LINES).toEqual({
      preparing: "Preparando la firma…",
      ready: "Firmá tu documento",
      verifying: "Verificando la firma…",
      signed: "Listo: el documento quedó firmado",
      alreadySigned: "Este documento ya quedó firmado",
      awaitingDelivery: "La firma se hizo, pero todavía no recibimos la copia",
      failed: "Algo falló; podés reintentar",
      deliveryFailed: "La firma se hizo, pero no pudimos guardar la copia. Reintentá el envío.",
      notFound: "Este enlace no existe",
      cancelled: "La firma se canceló",
      expired: "La sesión de firma venció",
      wrongPage: "Esta página no es la que corresponde a tu firma",
    });
    expect(DETAIL_LINES).toEqual({
      error: "error:",
      unknownError: "desconocido",
      statusUnreadable: "no se pudo leer el estado:",
      authoritativeState: "estado autoritativo:",
      archived: "verificado y archivado",
    });
    expect(Object.isFrozen(STATUS_LINES)).toBe(true);
    expect(Object.isFrozen(DETAIL_LINES)).toBe(true);
  });
});
