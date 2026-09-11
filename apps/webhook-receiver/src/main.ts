/**
 * Entry point. Reads configuration from the environment and starts listening.
 *
 * Refuses to start without a secret rather than starting and failing every
 * challenge: a receiver that is up and rejecting looks like a signature problem
 * and sends whoever is debugging it to the wrong place (STYLES §6.2).
 */

import { createReceiver } from "./server.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const path = process.env.LAKAUT_WEBHOOK_PATH ?? "/webhooks/lakaut";

const server = createReceiver({
  secret: required("LAKAUT_WEBHOOK_SECRET"),
  path,
  now: () => new Date(),
  // Structured and safe by construction: the line type carries no secret, no
  // signature and no payload (STYLES §8.1).
  log: (line) => console.log(JSON.stringify(line)),
});

server.listen(port, () => {
  console.log(JSON.stringify({ event: "listening", port, path }));
});
