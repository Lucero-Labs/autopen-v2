import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { probeDatabase } from "../src/health.ts";

const TIMEOUT = Object.freeze({ timeoutMs: 2_000 });

let listening: Server | undefined;

async function listen(): Promise<number> {
  listening = createServer();
  const server = listening;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

/** A port nothing listens on: bind one, release it, and use it before anything else can. */
async function closedPort(): Promise<number> {
  const port = await listen();
  await closeListening();
  return port;
}

async function closeListening(): Promise<void> {
  const server = listening;
  listening = undefined;
  if (server === undefined) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
}

afterEach(closeListening);

describe("probeDatabase", () => {
  it("is unconfigured without a URL and opens nothing", async () => {
    expect(await probeDatabase(undefined, TIMEOUT)).toBe("unconfigured");
  });

  it("is reachable when the host accepts a TCP connection, whatever speaks on it", async () => {
    const port = await listen();

    expect(await probeDatabase(`postgres://u:p@127.0.0.1:${port}/db`, TIMEOUT)).toBe("reachable");
  });

  it("is unreachable when the port is closed", async () => {
    const port = await closedPort();

    expect(await probeDatabase(`postgres://u:p@127.0.0.1:${port}/db`, TIMEOUT)).toBe("unreachable");
  });

  it("is unreachable rather than thrown when the URL cannot be parsed or names no host", async () => {
    expect(await probeDatabase("not a url", TIMEOUT)).toBe("unreachable");
    expect(await probeDatabase("postgres:///db", TIMEOUT)).toBe("unreachable");
  });

  it("gives up after the timeout on a host that never answers", async () => {
    // 192.0.2.0/24 is reserved for documentation and routes nowhere.
    const started = Date.now();
    const result = await probeDatabase("postgres://u:p@192.0.2.1:5432/db", { timeoutMs: 100 });

    expect(result).toBe("unreachable");
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});
