// Bundles the browser half into one module.
//
// `@lakaut/browser` is an npm package with its own dependency graph, so it
// cannot be served to a browser as-is. esbuild is the smallest thing that
// resolves that graph; it does not typecheck, which is why `pnpm typecheck`
// runs `tsconfig.web.json` over the same sources separately.

import { build } from "esbuild";

await build({
  entryPoints: ["web/client.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: "web/client.js",
  sourcemap: false,
  logLevel: "info",
});
