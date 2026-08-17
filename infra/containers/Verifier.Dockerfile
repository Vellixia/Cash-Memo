# syntax=docker/dockerfile:1.12

ARG NODE_IMAGE=node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
ARG RELEASE_SHA=0000000000000000000000000000000000000000
ARG BUILD_VERSION=0.0.0

FROM ${NODE_IMAGE} AS verifier
ARG RELEASE_SHA
ARG BUILD_VERSION
ARG PNPM_VERSION=11.13.1
ENV NODE_ENV=test \
    HOME=/tmp/cashmemo-verifier \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CASHMEMO_IMAGE_REVISION=${RELEASE_SHA} \
    COREPACK_HOME=/opt/corepack \
    PNPM_HOME=/opt/pnpm \
    PATH=/opt/pnpm:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
RUN corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && groupadd --system --gid 10003 verifier \
    && useradd --system --uid 10003 --gid verifier --home-dir /nonexistent --shell /usr/sbin/nologin verifier \
    && install -d -o verifier -g verifier /workspace /tmp/cashmemo-verifier
WORKDIR /workspace
COPY --chown=verifier:verifier package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=verifier:verifier apps/server/package.json apps/server/package.json
COPY --chown=verifier:verifier apps/web/package.json apps/web/package.json
COPY --chown=verifier:verifier packages/contracts/package.json packages/contracts/package.json
COPY --chown=verifier:verifier packages/currency-registry/package.json packages/currency-registry/package.json
COPY --chown=verifier:verifier packages/domain/package.json packages/domain/package.json
COPY --chown=verifier:verifier packages/privacy-rules/package.json packages/privacy-rules/package.json
COPY --chown=verifier:verifier packages/test-support/package.json packages/test-support/package.json
USER 10003:10003
RUN pnpm install --frozen-lockfile
USER root
RUN apt-get update \
    && apt-get upgrade --yes \
    && rm -rf /var/lib/apt/lists/* \
    && pnpm exec playwright install --with-deps chromium \
    && chmod -R a+rX /ms-playwright
USER 10003:10003
COPY --chown=verifier:verifier . .
RUN pnpm build
RUN rm -rf /workspace/.pnpm-store /root/.local/share/pnpm/store /tmp/*.pnp /workspace/node_modules/.cache
LABEL org.opencontainers.image.title="cashmemo-verifier" \
      org.opencontainers.image.description="Synthetic development and staging verification runner" \
      org.opencontainers.image.revision="${RELEASE_SHA}" \
      org.opencontainers.image.version="${BUILD_VERSION}" \
      dev.cashmemo.runtime.uid="10003" \
      dev.cashmemo.verifier.production="forbidden"
VOLUME ["/tmp/cashmemo-verifier"]
ENTRYPOINT ["node", "scripts/verify/development-verifier.mjs"]
CMD ["full-development"]
