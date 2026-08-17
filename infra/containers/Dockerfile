# syntax=docker/dockerfile:1.12

ARG NODE_IMAGE=node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
ARG RELEASE_SHA=0000000000000000000000000000000000000000
ARG BUILD_VERSION=0.0.0

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

FROM builder AS runtime-dependencies

USER root
RUN install -d -o node -g node /opt/cashmemo-server \
    && pnpm --filter @cashmemo/server deploy --prod --legacy /opt/cashmemo-server

FROM ${NODE_IMAGE} AS production

ARG RELEASE_SHA
ARG BUILD_VERSION

ENV NODE_ENV=production \
    CASHMEMO_IMAGE_REVISION=${RELEASE_SHA}

RUN groupadd --system --gid 10001 cashmemo \
    && useradd --system --uid 10001 --gid cashmemo --home-dir /nonexistent --shell /usr/sbin/nologin cashmemo \
    && apt-get update \
    && apt-get upgrade --yes \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    && install -d -o cashmemo -g cashmemo /workspace /var/lib/cashmemo/audio /var/lib/cashmemo/work

WORKDIR /workspace

COPY --from=runtime-dependencies --chown=cashmemo:cashmemo /opt/cashmemo-server ./server
COPY --from=builder --chown=cashmemo:cashmemo /workspace/apps/server/src/adapters/postgres/migrations ./apps/server/src/adapters/postgres/migrations
COPY --from=builder --chown=cashmemo:cashmemo /workspace/apps/web/dist ./apps/web/dist
COPY --from=builder --chown=cashmemo:cashmemo /workspace/scripts/db/migrate-production.mjs ./scripts/db/migrate-production.mjs
COPY --chown=cashmemo:cashmemo infra/containers/runtime-entrypoint.mjs /usr/local/lib/cashmemo/runtime-entrypoint.mjs
COPY --chown=cashmemo:cashmemo infra/containers/runtime-healthcheck.mjs /usr/local/lib/cashmemo/runtime-healthcheck.mjs

LABEL org.opencontainers.image.title="cashmemo-runtime" \
      org.opencontainers.image.revision="${RELEASE_SHA}" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      dev.cashmemo.runtime.roles="api,worker,migrate" \
      dev.cashmemo.runtime.uid="10001" \
      dev.cashmemo.dependency.baseline="pnpm-lock.yaml" \
      dev.cashmemo.runtime.root-filesystem="read-only-required"

USER 10001:10001
VOLUME ["/tmp", "/var/lib/cashmemo/audio", "/var/lib/cashmemo/work"]
EXPOSE 3000
ENTRYPOINT ["node", "/usr/local/lib/cashmemo/runtime-entrypoint.mjs"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/usr/local/lib/cashmemo/runtime-healthcheck.mjs", "ready"]
CMD ["api"]
