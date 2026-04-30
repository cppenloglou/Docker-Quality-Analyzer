# Rust microservice with multi-stage build and distroless
# Expect: very high score, minimal warnings
FROM rust:1.78-alpine AS chef

RUN apk add --no-cache musl-dev openssl-dev openssl-libs-static pkgconf
RUN cargo install cargo-chef

WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

COPY . .
RUN cargo build --release --bin api-gateway

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /app/target/release/api-gateway /usr/local/bin/api-gateway
COPY --from=builder /app/config /etc/api-gateway/config

ENV RUST_LOG=info
ENV CONFIG_PATH=/etc/api-gateway/config/production.toml

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=2s --retries=3 \
    CMD ["/usr/local/bin/api-gateway", "healthcheck"]

ENTRYPOINT ["/usr/local/bin/api-gateway"]
CMD ["serve", "--bind", "0.0.0.0:8080"]
