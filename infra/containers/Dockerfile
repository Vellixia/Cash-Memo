# syntax=docker/dockerfile:1.12

ARG NODE_IMAGE=node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8

FROM ${NODE_IMAGE} AS build-base

ARG PNPM_VERSION=11.13.1
ENV COREPACK_HOME=/opt/corepack \
    PNPM_HOME=/opt/pnpm \
    PATH=/opt/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && install -d -o node -g node /workspace /var/lib/cashmemo/audio /var/lib/cashmemo/work

WORKDIR /workspace

LABEL org.opencontainers.image.title="Cashmemo modular monolith" \
      org.opencontainers.image.description="Pinned non-root Cashmemo runtime baseline" \
      dev.cashmemo.runtime.root-filesystem="read-only-required"

FROM build-base AS development

ENV NODE_ENV=development

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/server/package.json apps/server/package.json
COPY --chown=node:node apps/web/package.json apps/web/package.json
COPY --chown=node:node packages/contracts/package.json packages/contracts/package.json
COPY --chown=node:node packages/currency-registry/package.json packages/currency-registry/package.json
COPY --chown=node:node packages/domain/package.json packages/domain/package.json
COPY --chown=node:node packages/privacy-rules/package.json packages/privacy-rules/package.json
COPY --chown=node:node packages/test-support/package.json packages/test-support/package.json
USER node
RUN pnpm install --frozen-lockfile
COPY --chown=node:node . .

VOLUME ["/tmp", "/var/lib/cashmemo/audio", "/var/lib/cashmemo/work"]
CMD ["pnpm", "dev"]

FROM development AS builder

RUN pnpm build

FROM ${NODE_IMAGE} AS production

ENV NODE_ENV=production

RUN groupadd --system --gid 10001 cashmemo \
    && useradd --system --uid 10001 --gid cashmemo --home-dir /nonexistent --shell /usr/sbin/nologin cashmemo \
    && install -d -o cashmemo -g cashmemo /workspace /var/lib/cashmemo/audio /var/lib/cashmemo/work

WORKDIR /workspace

COPY --from=builder --chown=cashmemo:cashmemo /workspace/node_modules ./node_modules
COPY --from=builder --chown=cashmemo:cashmemo /workspace/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder --chown=cashmemo:cashmemo /workspace/apps/server/dist ./apps/server/dist
COPY --from=builder --chown=cashmemo:cashmemo /workspace/apps/server/package.json ./apps/server/package.json
COPY --from=builder --chown=cashmemo:cashmemo /workspace/apps/server/src/adapters/postgres/migrations ./apps/server/src/adapters/postgres/migrations
COPY --from=builder --chown=cashmemo:cashmemo /workspace/apps/web/dist ./apps/web/dist
COPY --from=builder --chown=cashmemo:cashmemo /workspace/packages ./packages
COPY --from=builder --chown=cashmemo:cashmemo /workspace/scripts/db/migrate-production.mjs ./scripts/db/migrate-production.mjs

USER 10001:10001
VOLUME ["/tmp", "/var/lib/cashmemo/audio", "/var/lib/cashmemo/work"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "apps/server/dist/src/bootstrap/server.js"]
