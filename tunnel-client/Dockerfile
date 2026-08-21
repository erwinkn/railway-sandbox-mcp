FROM ghcr.io/openai/tunnel-client:latest

# Railway health checks target its injected PORT. The upstream image defaults
# its health/admin listener to 127.0.0.1:8080, so bind it to Railway's port
# explicitly while preserving the official tunnel-client runtime.
ENTRYPOINT ["/bin/sh", "-c", "exec /usr/bin/tunnel-client run --health.listen-addr=0.0.0.0:${PORT:-8080}"]
