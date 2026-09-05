# apps

Deployable things. An app is something you run: an API server, a web frontend,
a worker.

Nothing in `packages/` may import from here. Apps depend on packages; packages
never depend on apps.

## What goes here vs. in `packages/`

The test is **deployable or importable**, not *shared* or *product-specific*.

| | |
| --- | --- |
| `apps/` | Has a process. You start it, deploy it, point a URL at it. |
| `packages/` | Has no process. Something else imports it. |

So a rule set written for exactly one product — `packages/rules-pagare-ar` — still
belongs in `packages/`, because it is a library with no runtime and a second
product doing Argentine pagarés should be able to import it. The vehicle-loan
origination product that *uses* those rules, with its originador panel and its
borrower route, is an app.

Getting this backwards is the expensive mistake: burying a reusable rule set
inside an app means the next product either copies it or reaches across an app
boundary to get it.

## Adding one

Create `apps/<name>/` with a `package.json` named `@autopen/<name>`. pnpm and
Turborepo pick it up from the workspace glob; no registration step.

Depend on core packages with `"@autopen/gate": "workspace:*"`.
