/**
 * The health check's one live probe: whether the database host answers on its port.
 *
 * A TCP connect and nothing more — no client library, no SQL, no credential
 * sent — because this deployment proves that the wiring reaches the database,
 * not that queries run. The URL is parsed for its host and port and never
 * printed or returned: it carries the password (STYLES §8.1).
 */

import { createConnection } from "node:net";

import type { DatabaseReachability } from "./wire.ts";

/** Postgres's registered port, used when the URL names none. */
const DEFAULT_DATABASE_PORT = 5432;

/** Answers whether the configured database, if any, accepts a connection right now. */
export type DatabaseProbe = () => Promise<DatabaseReachability>;

/**
 * Opens a TCP connection to the URL's host and port, closes it, and says whether it opened.
 *
 * `unconfigured` when there is no URL; `unreachable` when the URL cannot be
 * parsed, is refused, or does not answer within `timeoutMs`. A URL that cannot
 * be parsed is reported as unreachable rather than thrown: the health route
 * must answer, and its answer must not contain the value that failed to parse.
 */
export function probeDatabase(
  url: string | undefined,
  options: { readonly timeoutMs: number },
): Promise<DatabaseReachability> {
  if (url === undefined) return Promise.resolve("unconfigured");

  let host: string;
  let port: number;
  try {
    const parsed = new URL(url);
    // `hostname` keeps the brackets of an IPv6 literal; `createConnection` does not want them.
    host = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
    port = parsed.port === "" ? DEFAULT_DATABASE_PORT : Number(parsed.port);
  } catch {
    return Promise.resolve("unreachable");
  }
  if (host === "") return Promise.resolve("unreachable");

  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const settle = (result: DatabaseReachability): void => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(options.timeoutMs, () => settle("unreachable"));
    socket.once("connect", () => settle("reachable"));
    socket.once("error", () => settle("unreachable"));
  });
}
