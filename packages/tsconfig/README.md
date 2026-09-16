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

A variant used by exactly one config stays beside that config —
`adapter-lakaut/tsconfig.browser.json`, `signing-demo/tsconfig.web.json` — until
a second consumer exists.
