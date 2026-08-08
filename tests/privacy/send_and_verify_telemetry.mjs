import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputDirectory = resolve(required("CASHMEMO_PRIVACY_CAPTURE_DIR"));
const corpus = JSON.parse(
  await readFile(resolve("tests/privacy/fixtures/canaries.json"), "utf8"),
);
const startedMicros = (Date.now() - 60_000) * 1_000;
const endedNanos = BigInt(Date.now()) * 1_000_000n;
const startedNanos = endedNanos - 1_000_000n;
const traceId = "11111111111111111111111111111111";
const spanId = "2222222222222222";
const attributes = corpus.entries.flatMap((entry) =>
  variants(entry.raw).map((value, index) => ({
    key: `untrusted.${entry.id}.${index}`,
    value: { stringValue: value },
  })),
);

await postOtlp("traces", {
  resourceSpans: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: { stringValue: "cashmemo-privacy-gate" },
          },
          ...attributes,
        ],
      },
      scopeSpans: [
        {
          scope: { name: "cashmemo.privacy.gate" },
          spans: [
            {
              traceId,
              spanId,
              name: corpus.entries[1].raw,
              kind: 1,
              startTimeUnixNano: startedNanos.toString(),
              endTimeUnixNano: endedNanos.toString(),
              attributes,
              status: { message: corpus.entries[1].raw, code: 2 },
              events: [
                {
                  timeUnixNano: endedNanos.toString(),
                  name: corpus.entries[1].raw,
                  attributes,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
});

await postOtlp("logs", {
  resourceLogs: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: { stringValue: "cashmemo-privacy-gate" },
          },
          ...attributes,
        ],
      },
      scopeLogs: [
        {
          scope: { name: "cashmemo.privacy.gate" },
          logRecords: [
            {
              timeUnixNano: endedNanos.toString(),
              severityNumber: 9,
              severityText: corpus.entries[1].raw,
              body: { stringValue: corpus.entries[1].raw },
              attributes,
              traceId,
              spanId,
            },
          ],
        },
      ],
    },
  ],
});

await postOtlp("metrics", {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          {
            key: "service.name",
            value: { stringValue: "cashmemo-privacy-gate" },
          },
          ...attributes,
        ],
      },
      scopeMetrics: [
        {
          scope: { name: "cashmemo.privacy.gate" },
          metrics: [
            {
              name: corpus.entries[1].raw,
              description: corpus.entries[2].raw,
              unit: "1",
              gauge: {
                dataPoints: [
                  {
                    attributes,
                    timeUnixNano: endedNanos.toString(),
                    asDouble: 1,
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
});

await new Promise((resolveDelay) => setTimeout(resolveDelay, 8_000));
const authorization = `Basic ${Buffer.from(
  `${required("OPENOBSERVE_ROOT_EMAIL")}:${required("OPENOBSERVE_ROOT_PASSWORD")}`,
).toString("base64")}`;
const streamsResponse = await fetch(
  "http://127.0.0.1:5080/api/default/streams?fetchSchema=true",
  { headers: { Authorization: authorization } },
);
if (!streamsResponse.ok)
  throw new Error("OpenObserve stream inventory unavailable");
const streams = await streamsResponse.json();
const captures = [];
for (const stream of streamItems(streams)) {
  const streamName = typeof stream.name === "string" ? stream.name : null;
  const streamType =
    typeof stream.stream_type === "string" ? stream.stream_type : null;
  if (streamName === null || streamType === null) continue;
  const response = await fetch(
    `http://127.0.0.1:5080/api/default/_search?type=${encodeURIComponent(streamType)}`,
    {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: {
          sql: `SELECT * FROM \"${streamName.replaceAll('"', '""')}\"`,
          start_time: startedMicros,
          end_time: Date.now() * 1_000,
          from: 0,
          size: 100,
        },
      }),
    },
  );
  if (!response.ok) continue;
  captures.push({ streamName, streamType, result: await response.json() });
}
const encoded = JSON.stringify(captures);
if (!encoded.includes(traceId)) {
  throw new Error("OpenObserve did not return transformed trace evidence");
}
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "openobserve.json"), `${encoded}\n`, {
  mode: 0o600,
});
process.stdout.write("transformed OTLP signals verified in OpenObserve\n");

async function postOtlp(signal, body) {
  const response = await fetch(`http://127.0.0.1:4318/v1/${signal}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`OTLP ${signal} ingestion failed`);
}

function streamItems(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.list)) return value.list;
  if (Array.isArray(value.streams)) return value.streams;
  return [];
}

function variants(value) {
  return [
    value,
    JSON.stringify(value).slice(1, -1),
    encodeURIComponent(value),
    Buffer.from(value, "utf8").toString("base64"),
    createHash("sha256").update(value).digest("hex"),
  ];
}

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} required`);
  return value;
}
