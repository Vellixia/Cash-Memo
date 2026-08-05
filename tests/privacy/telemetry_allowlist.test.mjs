import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import YAML from "yaml";

test("OTel collector keeps only the reviewed diagnostic allowlist before export", async () => {
  const configuration = YAML.parse(
    await readFile("infra/otel-collector/config.yaml", "utf8"),
  );
  const processors =
    configuration.processors["transform/privacy_allowlist"].trace_statements[0]
      .statements;
  assert.deepEqual(processors, [
    'keep_keys(attributes, ["http.request.method", "http.response.status_code", "http.route", "cashmemo.error_code", "cashmemo.operation", "service.version"])',
    'set(name, "cashmemo.request")',
  ]);
  assert.deepEqual(configuration.service.pipelines.traces.processors, [
    "memory_limiter",
    "transform/privacy_allowlist",
    "batch",
  ]);
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
