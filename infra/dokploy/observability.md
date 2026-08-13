# Shared OTLP/OpenObserve integration

Cashmemo uses `OTEL_EXPORTER_OTLP_ENDPOINT` to send allowlisted signals to the existing shared OTel
Collector, which routes to existing OpenObserve. No duplicate collector/OpenObserve service or
direct OpenObserve SDK is permitted. Phase 14 safe telemetry types remain the only application
diagnostic API. Deployment verification seeds synthetic canaries and scans collector-visible logs,
metrics, and traces; leak count must be zero.
