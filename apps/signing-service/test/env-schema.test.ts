import { describe, expect, it } from "vitest";
import { z } from "zod";

import { DEFAULT_PORT, ENV_SCHEMA } from "../src/env-schema.ts";

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
