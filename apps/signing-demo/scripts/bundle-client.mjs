// Bundles the two browser halves, one module each.
//
// `@lakaut/browser` is an npm package with its own dependency graph, so it
// cannot be served to a browser as-is. esbuild is the smallest thing that
// resolves that graph; it does not typecheck, which is why `pnpm typecheck`
// runs `tsconfig.web.json` over the same sources separately.
//
// `client.ts` is the issuer's page and `sign.ts` the signing page; each is
// served by name from `web/`, so each gets its own bundle rather than a shared
// one the other would have to load.

import { build } from "esbuild";

await build({
  entryPoints: ["web/client.ts", "web/sign.ts"],
  bundle: true,
  format: "esm",
  target: "es2022",
  outdir: "web",
  sourcemap: false,
  logLevel: "info",
});
