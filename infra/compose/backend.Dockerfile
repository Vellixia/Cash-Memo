FROM rust:1.97.1-bookworm AS builder
WORKDIR /src
COPY backend ./backend
COPY shared ./shared
RUN cargo build --manifest-path backend/Cargo.toml --release --locked

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /src/backend/target/release/cashmemo /usr/local/bin/cashmemo
USER 65532:65532
ENTRYPOINT ["cashmemo"]
CMD ["serve"]
