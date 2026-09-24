# The signing service as a container image, for Railway or any host that builds a
# Dockerfile. Mirrors .github/workflows/ci.yml rather than inventing a second
# install path: corepack picks pnpm from `packageManager`, the @lakaut scope is
# routed by copying .npmrc.example, and the Nexus credential arrives as a build
# argument read only by `pnpm install` (AGENTS.md, "Environment").
#
# Three stages. `build` installs everything and compiles; `prod-deps` installs
# only what the service needs at runtime; `runtime` copies built output from the
# first and node_modules from the second. A build argument used in an earlier
# stage is not recorded in the final image, and `ENV LAKAUT_NPM_AUTH` appears
# nowhere, so the credential reaches no image layer. Whether it is present in
# the running container's environment is the host's doing — Railway injects
# every service variable at runtime too — and `env.ts` ignores it.
#
# The Node major is the one .nvmrc pins. `--env-file-if-exists` in the service's
# start script needs 22.9 or later, which `node:22-slim` is.
#
#   docker build --build-arg LAKAUT_NPM_AUTH="$LAKAUT_NPM_AUTH" -f apps/signing-service/Dockerfile -t signing-service .
#   docker run --rm -p 3000:3000 --env-file .env signing-service

FROM node:22-slim AS base
RUN corepack enable
WORKDIR /app

# Manifests first, so the install layer is reused while only sources change.
# `CI=true` keeps lefthook's postinstall from wiring hooks into a repository
# that is not there. Dev dependencies are needed here: tsc, esbuild, turbo.
FROM base AS build
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc.example ./
COPY packages/core/package.json packages/core/
COPY packages/gate/package.json packages/gate/
COPY packages/rules-pagare-ar/package.json packages/rules-pagare-ar/
COPY packages/adapter-lakaut/package.json packages/adapter-lakaut/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY apps/signing-service/package.json apps/signing-service/
RUN cp .npmrc.example .npmrc
ARG LAKAUT_NPM_AUTH
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Production dependencies of the service and of the packages it imports, resolved
# from the manifests alone. A filtered `--prod` install rather than
# `pnpm deploy`: with this workspace's shared lockfile, pnpm 10's `deploy`
# needs either `--legacy`, which produced an empty node_modules when tried, or
# `inject-workspace-packages`, which rewrites the lockfile. This keeps the
# workspace layout — `@autopen/*` are relative symlinks into `packages/` — and
# the lockfile untouched.
FROM base AS prod-deps
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc.example ./
COPY packages/core/package.json packages/core/
COPY packages/adapter-lakaut/package.json packages/adapter-lakaut/
COPY apps/signing-service/package.json apps/signing-service/
RUN cp .npmrc.example .npmrc
ARG LAKAUT_NPM_AUTH
RUN pnpm install --frozen-lockfile --prod --filter "@autopen/signing-service..."

# No pnpm, no compiler, no source: the built output, its runtime dependencies,
# and the two pages. The `node` user comes with the base image; the default
# evidence directory is created for it so the service boots without a volume.
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/adapter-lakaut/node_modules ./packages/adapter-lakaut/node_modules
COPY --from=prod-deps /app/apps/signing-service/node_modules ./apps/signing-service/node_modules
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/adapter-lakaut/package.json ./packages/adapter-lakaut/
COPY --from=build /app/packages/adapter-lakaut/dist ./packages/adapter-lakaut/dist
COPY --from=build /app/apps/signing-service/package.json ./apps/signing-service/
COPY --from=build /app/apps/signing-service/dist ./apps/signing-service/dist
COPY --from=build /app/apps/signing-service/web ./apps/signing-service/web
RUN mkdir -p /app/apps/signing-service/evidence && chown node:node /app/apps/signing-service/evidence
USER node
WORKDIR /app/apps/signing-service
EXPOSE 3000
# The service's `start` script, spelled out in exec form so node is PID 1 with no
# shell or npm in front of it to swallow signals; server.ts handles SIGTERM.
# `../../.env` resolves to /app/.env, which does not exist in the image; the
# `-if-exists` flag makes that a no-op and the host's variables are what count.
CMD ["node", "--env-file-if-exists=../../.env", "dist/server.js"]
