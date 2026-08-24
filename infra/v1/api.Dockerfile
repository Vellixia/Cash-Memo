FROM rust:1.90-bookworm AS builder

WORKDIR /src
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY apps/api ./apps/api
RUN cargo build --locked --release --features s3-receipts --bin cashmemo-api \
    && strip target/release/cashmemo-api

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl libssl3 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 cashmemo \
    && useradd --system --uid 10001 --gid cashmemo --no-create-home --home-dir /nonexistent cashmemo

COPY --from=builder --chown=10001:10001 /src/target/release/cashmemo-api /usr/local/bin/cashmemo-api

USER 10001:10001
EXPOSE 3000
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/cashmemo-api"]
CMD ["serve"]
