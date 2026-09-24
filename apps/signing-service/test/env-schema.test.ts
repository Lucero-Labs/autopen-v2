import { createEnv } from "@t3-oss/env-core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DEFAULT_PORT, ENV_SCHEMA, reportInvalidEnvironment } from "../src/env-schema.ts";

/** Every required variable, as strings, the way a process environment carries them. */
const COMPLETE: Record<string, string> = Object.freeze({
  LAKAUT_AUTH_BASE_URL: "https://auth.example.invalid",
  LAKAUT_INTEGRATOR_ID: "00000000-0000-4000-8000-000000000000",
  LAKAUT_API_KEY: "not-a-real-lakaut-key",
  LAKAUT_ENVIRONMENT: "sandbox",
  LAKAUT_ALLOWED_ORIGIN: "https://demo.example.invalid",
  LAKAUT_HOSTED_UI_ORIGIN: "https://hosted-ui.example.invalid",
  AUTOPEN_API_KEY: "not-a-real-autopen-key-".padEnd(32, "x"),
});

const schema = z.object(ENV_SCHEMA);

function parse(overrides: Record<string, string>) {
  return schema.safeParse({ ...COMPLETE, ...overrides });
}

function messagesOf(result: ReturnType<typeof parse>): string[] {
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("the environment schema", () => {
  it("defaults PORT to 3000 when the environment names none", () => {
    const result = parse({});

    expect(result.success).toBe(true);
    expect(result.data?.PORT).toBe(3000);
    expect(DEFAULT_PORT).toBe(3000);
  });

  it("reads PORT from the string the environment carries", () => {
    expect(parse({ PORT: "8080" }).data?.PORT).toBe(8080);
  });

  it("refuses a PORT outside 1–65535 or with a fraction", () => {
    expect(parse({ PORT: "0" }).success).toBe(false);
    expect(parse({ PORT: "65536" }).success).toBe(false);
    expect(parse({ PORT: "80.5" }).success).toBe(false);
    expect(parse({ PORT: "eighty" }).success).toBe(false);
  });

  it("requires AUTOPEN_API_KEY to be at least 32 characters, and says how to make one", () => {
    const result = parse({ AUTOPEN_API_KEY: "x".repeat(31) });

    expect(result.success).toBe(false);
    expect(messagesOf(result)).toEqual([
      "must be at least 32 characters — generate one with `openssl rand -base64 32`",
    ]);
    expect(parse({ AUTOPEN_API_KEY: "x".repeat(32) }).success).toBe(true);
  });

  it("leaves EVIDENCE_DIR and DATABASE_URL optional, and refuses a DATABASE_URL that is not a URL", () => {
    const bare = parse({});
    expect(bare.data?.EVIDENCE_DIR).toBeUndefined();
    expect(bare.data?.DATABASE_URL).toBeUndefined();

    expect(parse({ EVIDENCE_DIR: "/data/evidence" }).data?.EVIDENCE_DIR).toBe("/data/evidence");
    expect(
      parse({ DATABASE_URL: "postgres://user:not-a-real-password@db.example.invalid:5432/app" })
        .success,
    ).toBe(true);
    expect(parse({ DATABASE_URL: "db.example.invalid" }).success).toBe(false);
  });

  it("names the variable and never its value when a key is malformed", () => {
    const result = parse({ AUTOPEN_API_KEY: "short-secret-value" });

    expect(result.success).toBe(false);
    expect(JSON.stringify(messagesOf(result))).not.toContain("short-secret-value");
  });
});

describe("the environment reporter", () => {
  /** `env.ts` minus `process.env`: the same options over a record a test controls. */
  function boot(runtimeEnv: Record<string, string>): () => unknown {
    return () =>
      createEnv({
        server: ENV_SCHEMA,
        runtimeEnv,
        emptyStringAsUndefined: true,
        onValidationError: reportInvalidEnvironment,
      });
  }

  it("throws one error naming each bad variable and its message, and no value", () => {
    const failing = boot({
      ...COMPLETE,
      LAKAUT_API_KEY: "",
      AUTOPEN_API_KEY: "bogus-autopen-key-value",
      LAKAUT_INTEGRATOR_ID: "bogus-integrator-value",
    });

    expect(failing).toThrow(/^the environment is invalid:\n/);
    expect(failing).toThrow("  LAKAUT_API_KEY is required");
    expect(failing).toThrow("  AUTOPEN_API_KEY must be at least 32 characters");
    expect(failing).toThrow(
      '  LAKAUT_INTEGRATOR_ID must be the canonical UUID under "Empresa / contrato"',
    );
    expect(failing).toThrow("Copy .env.example to .env, fill it in, and restart");

    let message = "";
    try {
      failing();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // Guards a future zod or t3 that puts the input on an issue; today none does.
    expect(message).not.toContain("bogus-autopen-key-value");
    expect(message).not.toContain("bogus-integrator-value");
    expect(message).not.toContain(COMPLETE.LAKAUT_API_KEY);
  });

  it("lets a complete environment through untouched", () => {
    expect(boot(COMPLETE)()).toMatchObject({ LAKAUT_ENVIRONMENT: "sandbox", PORT: DEFAULT_PORT });
  });
});
