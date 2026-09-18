# storoku:ignore
# syntax=docker.io/docker/dockerfile:1

# node:24.18.1-slim (glibc), not alpine: the build pulls native binaries for
# @tailwindcss/oxide, lightningcss, unrs-resolver and esbuild. Their musl
# variants exist but are the less-travelled path, and unrs-resolver is in
# pnpm's ignoredBuiltDependencies so it cannot fall back to a source build.
FROM node:24.18.1-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NEXT_TELEMETRY_DISABLED=1
ENV TURBO_TELEMETRY_DISABLED=1
ENV DO_NOT_TRACK=1
WORKDIR /app
# packageManager in package.json pins pnpm@10.34.5; corepack provisions exactly that.
COPY package.json ./package.json
RUN corepack enable && corepack install

# ---------------------------------------------------------------- dependencies
FROM base AS deps
# .npmrc sets engine-strict=true; node 24.18.1 satisfies engines.node ">=24.15 <25".
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml ./
# patches/ must exist before install: pnpm.patchedDependencies applies on every
# install including --frozen-lockfile (patches/README.md).
COPY patches ./patches
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch

COPY apps/web/package.json ./apps/web/package.json
COPY packages/api/package.json ./packages/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/documents/package.json ./packages/documents/package.json
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/integrations/package.json ./packages/integrations/package.json
COPY packages/testing/package.json ./packages/testing/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/workflows/package.json ./packages/workflows/package.json

# --prefer-offline rather than --offline: the store is a cache mount, which a
# fresh runner starts without even when the fetch layer above is a cache hit.
# --ignore-scripts keeps two things out of the image: the root "prepare" script
# (lefthook install, which wants a git work tree) and the supabase devDependency's
# postinstall, which downloads a CLI binary from GitHub -- the runner stage
# installs a pinned, checksum-verified one instead. Nothing the web build needs
# has a build script; sharp only enters the graph through the Netlify image
# plugin (ipx), which this image does not run.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline --ignore-scripts

# --------------------------------------------------------------------- builder
FROM base AS builder
# Every node_modules tree pnpm created, then the source. The per-package
# directories are symlink farms into the root node_modules/.pnpm store, so they
# have to travel with it rather than being recreated; they come first so a
# source edit invalidates one layer rather than twelve. .dockerignore keeps
# every node_modules out of the context, so the source copy cannot clobber them.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/api/node_modules ./packages/api/node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/documents/node_modules ./packages/documents/node_modules
COPY --from=deps /app/packages/domain/node_modules ./packages/domain/node_modules
COPY --from=deps /app/packages/integrations/node_modules ./packages/integrations/node_modules
COPY --from=deps /app/packages/testing/node_modules ./packages/testing/node_modules
COPY --from=deps /app/packages/ui/node_modules ./packages/ui/node_modules
COPY --from=deps /app/packages/workflows/node_modules ./packages/workflows/node_modules
COPY . .

# apps/web/next.config.ts reads this and switches on `output: "standalone"` plus
# the workspace trace root. Off by default there because the Vercel and Netlify
# targets want the normal output; a container needs the server Next emits.
ENV CLOCKWORK_NEXT_STANDALONE=1

# Per-environment build input, rendered by the deploy Makefile from the
# environment's Terraform outputs and SSM parameters. It has to exist: Next
# inlines every NEXT_PUBLIC_* value into the client bundles at build time, so an
# image built without it would serve the wrong origin at runtime with no way to
# correct it short of a rebuild. Failing here is the visible version of that.
# It lands in apps/web because that is the directory `next build` loads
# .env.production.local from.
COPY deploy/.env.production.local ./apps/web/.env.production.local

RUN pnpm exec turbo run build --filter=@clockwork/web

# The migrate task also applies the production bootstrap (deploy/docker/
# migrate.sh). Its CLI is TypeScript over the workspace packages, and the
# runner carries neither sources nor node_modules, so it ships as one file.
RUN pnpm exec esbuild scripts/bootstrap-production.ts --bundle --platform=node \
    --target=node24 --format=esm --outfile=bootstrap/bootstrap-production.mjs

# ---------------------------------------------------------------------- runner
FROM node:24.18.1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# The Supabase CLI keeps per-user state under $HOME, so the runtime user needs
# one it owns. Without it `supabase db push` fails on its own state file before
# it reaches the database.
ENV HOME=/home/clockwork
# Honoured by the Supabase CLI. A migrate task that phones home on every deploy
# is one more thing that can fail in a private subnet.
ENV DO_NOT_TRACK=1
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --home-dir /home/clockwork clockwork && \
    install -d -o clockwork -g nodejs /home/clockwork

# The migrate task runs from this same image, so psql and the Supabase CLI ship
# with the application rather than in a second image that could drift from the
# migrations it applies. Pinned and checksum-verified: `supabase db push` is the
# one command in this deployment that rewrites a production schema, and the
# version that does it should not change because upstream published a release.
ARG SUPABASE_VERSION=2.111.0
ARG TARGETARCH
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl postgresql-client; \
    tarball="supabase_${SUPABASE_VERSION}_linux_${TARGETARCH}.tar.gz"; \
    cd /tmp; \
    curl -fsSLO "https://github.com/supabase/cli/releases/download/v${SUPABASE_VERSION}/${tarball}"; \
    curl -fsSLO "https://github.com/supabase/cli/releases/download/v${SUPABASE_VERSION}/checksums.txt"; \
    grep "  ${tarball}\$" checksums.txt | sha256sum -c -; \
    tar -xzf "${tarball}" supabase; \
    install -m 0755 supabase /usr/local/bin/supabase; \
    rm -f "${tarball}" checksums.txt supabase; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/*; \
    psql --version; \
    supabase --version; \
    # The version check above runs as root and leaves a root-owned ~/.supabase
    # behind, which the runtime user then cannot write. Hand the home directory
    # back rather than leaving a failure that only appears on a migrate run.
    chown -R clockwork:nodejs /home/clockwork

COPY --from=builder --chown=clockwork:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=clockwork:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=clockwork:nodejs /app/apps/web/public ./apps/web/public

# What the migrate task reads. config.toml, seed.sql and supabase/tests are
# development fixtures and stay out: `supabase db push --db-url` needs only the
# migrations directory, and config.toml would carry the dev seed settings into
# the production migration path.
COPY --chown=clockwork:nodejs supabase/migrations ./supabase/migrations
COPY --chown=clockwork:nodejs supabase/production-roles.sql ./supabase/production-roles.sql
COPY --chown=clockwork:nodejs deploy/docker ./deploy/docker
COPY --from=builder --chown=clockwork:nodejs /app/bootstrap ./bootstrap
RUN chmod 0755 /app/deploy/docker/entrypoint.sh /app/deploy/docker/migrate.sh

USER clockwork
EXPOSE 3000
# The entrypoint composes DATABASE_URL and CLOCKWORK_SERVICE_DATABASE_URL from
# the pieces ECS injects, then execs the command. It runs in front of the web
# server and of deploy/docker/migrate.sh alike.
ENTRYPOINT ["/app/deploy/docker/entrypoint.sh"]
CMD ["node", "apps/web/server.js"]
