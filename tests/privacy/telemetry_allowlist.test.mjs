import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import YAML from "yaml";

test("OTel collector keeps only the reviewed diagnostic allowlist before export", async () => {
  const configuration = YAML.parse(
    await readFile("infra/otel-collector/config.yaml", "utf8"),
  );
  const transform = configuration.processors["transform/privacy_allowlist"];
  assert.deepEqual(transform.trace_statements[0].statements, [
    'keep_keys(attributes, ["service.name", "service.version", "deployment.environment.name"])',
  ]);
  assert.deepEqual(transform.trace_statements[1].statements, [
    'keep_keys(attributes, ["http.request.method", "http.response.status_code", "http.route", "cashmemo.error_code", "cashmemo.operation", "service.version"])',
    'set(name, "cashmemo.request")',
    'set(status.message, "")',
  ]);
  assert.deepEqual(transform.trace_statements[2].statements, [
    'keep_keys(attributes, ["cashmemo.error_code", "cashmemo.operation"])',
    'set(name, "cashmemo.event")',
  ]);
  assert.deepEqual(transform.log_statements[1].statements, [
    'keep_keys(attributes, ["cashmemo.error_code", "cashmemo.operation", "service.version"])',
    'set(body, "cashmemo.event")',
    'set(severity_text, "")',
  ]);
  assert.deepEqual(transform.metric_statements[1].statements, [
    'set(name, "cashmemo.metric")',
    'set(description, "")',
  ]);
  for (const signal of ["traces", "logs", "metrics"]) {
    assert.deepEqual(configuration.service.pipelines[signal].processors, [
      "memory_limiter",
      "transform/privacy_allowlist",
      "batch",
    ]);
    assert.deepEqual(configuration.service.pipelines[signal].exporters, [
      "otlphttp/openobserve",
      "debug/privacy_evidence",
    ]);
  }
  assert.equal(
    configuration.exporters["otlphttp/openobserve"].headers.Authorization,
    "Basic ${env:OPENOBSERVE_AUTH_CREDENTIAL}",
  );
  const encoded = JSON.stringify(configuration);
  for (const forbidden of [
    "http.request.body",
    "http.request.header",
    "url.query",
    "db.statement",
    "enduser.id",
    "exception.stacktrace",
  ]) {
    assert.equal(encoded.includes(forbidden), false);
  }
});
