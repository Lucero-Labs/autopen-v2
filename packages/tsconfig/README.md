# @autopen/tsconfig

The compiler settings every package and app extends. One place to change them,
so two packages cannot quietly disagree about `strict` or module resolution.

| File | Extend it from | What it adds to `base.json` |
| --- | --- | --- |
| `base.json` | a config with its own `include`, such as a browser build | nothing — strict ESM under `NodeNext` |
| `library.json` | a package's or app's `tsconfig.json` | emit `src/` into `dist/` |
| `typecheck.json` | a package's `tsconfig.typecheck.json` | no emit, over `src/` and `test/` |

```json
{ "extends": "@autopen/tsconfig/library.json" }
```

Paths are written as `${configDir}/…`, which TypeScript resolves against the
config doing the extending rather than this package. That is what lets a
package's own `tsconfig.json` be one line. A plain relative path here would point
into `packages/tsconfig/` for every consumer.

`base.json` sets `"types": []`, so no ambient type package is included unless a
config asks for it. TypeScript otherwise loads every `@types/*` in every
`node_modules` above the project — including one outside the repository — and a
package using `Buffer` without declaring `@types/node` compiles on one laptop and
fails in CI. A package that uses Node APIs declares `@types/node` (from the
catalog) and adds `"compilerOptions": { "types": ["node"] }`.

A variant used by exactly one config stays beside that config —
`adapter-lakaut/tsconfig.browser.json`, `signing-demo/tsconfig.web.json` — until
a second consumer exists.
