# apps

Deployable things. An app is something you run: an API server, a web frontend,
a worker.

Nothing in `packages/` may import from here. Apps depend on packages; packages
never depend on apps.

## What goes here vs. in `packages/`

The test is **deployable or importable**.

| | |
| --- | --- |
| `apps/` | Has a process. You start it, deploy it, point a URL at it. |
| `packages/` | Has no process. Something else imports it. |

So `packages/rules-pagare-ar`, a rule set with no runtime, is a package. A
server that runs those rules through the gate and hands the result to a
ceremony would be an app.

## Adding one

Create `apps/<name>/` with a `package.json` named `@autopen/<name>`. pnpm and
Turborepo pick it up from the workspace glob; no registration step.

Depend on core packages with `"@autopen/gate": "workspace:*"`.
