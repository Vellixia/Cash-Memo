# syntax=docker/dockerfile:1.12
ARG BASE_IMAGE=node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
FROM ${BASE_IMAGE} AS build

ARG PGBACKREST_VERSION=2.59.0
ARG PGBACKREST_SHA256=faaf8faa14a6392279654ee216a493fcd07b0c513af4b55fe34faec062cb8875
RUN apt-get update \
    && apt-get install --yes --no-install-recommends build-essential ca-certificates curl libbz2-dev liblz4-dev libpq-dev libssh2-1-dev libssl-dev libxml2-dev libyaml-dev libzstd-dev meson ninja-build pkg-config \
    && curl --fail --location --proto '=https' --tlsv1.2 --output /tmp/pgbackrest.tar.gz "https://github.com/pgbackrest/pgbackrest/releases/download/release%2F${PGBACKREST_VERSION}/pgbackrest-${PGBACKREST_VERSION}.tar.gz" \
    && echo "${PGBACKREST_SHA256}  /tmp/pgbackrest.tar.gz" | sha256sum --check --strict \
    && mkdir /tmp/pgbackrest \
    && tar --extract --gzip --file /tmp/pgbackrest.tar.gz --directory /tmp/pgbackrest --strip-components=1 \
    && meson setup /tmp/pgbackrest/build /tmp/pgbackrest \
    && ninja -C /tmp/pgbackrest/build \
    && DESTDIR=/tmp/root ninja -C /tmp/pgbackrest/build install

FROM ${BASE_IMAGE} AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates libbz2-1.0 liblz4-1 libpq5 libssh2-1 libssl3 libxml2 libyaml-0-2 libzstd1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10002 pgbackrest \
    && useradd --system --uid 10002 --gid pgbackrest --home-dir /nonexistent --shell /usr/sbin/nologin pgbackrest \
    && install -d -o pgbackrest -g pgbackrest /etc/pgbackrest /var/lib/pgbackrest /var/log/pgbackrest /var/spool/pgbackrest
COPY --from=build /tmp/root/usr/local/bin/pgbackrest /usr/local/bin/pgbackrest
USER 10002:10002
ENTRYPOINT ["pgbackrest"]
CMD ["version"]
