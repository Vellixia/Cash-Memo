import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

type Canary = Readonly<{ id: string; class: string; raw: string }>;
type Corpus = Readonly<{
  version: string;
  derivations: string[];
  entries: Canary[];
  safeDetectorIds: string[];
}>;
type Channel =
  | "browser"
  | "backend"
  | "proxy"
  | "appwrite"
  | "container"
  | "http_error"
  | "otlp"
  | "openobserve"
  | "crash"
  | "evidence";
type Capture = Readonly<{ channel: Channel; source: string; text: string }>;

const corpusPath = resolve("tests/privacy/fixtures/canaries.json");
const corpus = JSON.parse(await readFile(corpusPath, "utf8")) as Corpus;

function variants(
  canary: Canary,
): Array<Readonly<{ kind: string; value: string }>> {
  return [
    { kind: "raw", value: canary.raw },
    { kind: "json_escaped", value: JSON.stringify(canary.raw).slice(1, -1) },
    { kind: "url_encoded", value: encodeURIComponent(canary.raw) },
    {
      kind: "base64",
      value: Buffer.from(canary.raw, "utf8").toString("base64"),
    },
    {
      kind: "sha256",
      value: createHash("sha256").update(canary.raw).digest("hex"),
    },
  ];
}

function scan(captures: Capture[]): string[] {
  const findings: string[] = [];
  for (const capture of captures) {
    for (const canary of corpus.entries) {
      for (const variant of variants(canary)) {
        if (capture.text.includes(variant.value)) {
          findings.push(
            `${capture.channel}:${capture.source}:${canary.id}:${variant.kind}`,
          );
        }
      }
    }
    for (const detectorId of corpus.safeDetectorIds) {
      const allowedHttpFieldError =
        capture.channel === "http_error" &&
        capture.text.includes('"code":"PRIVACY_INPUT_REJECTED"') &&
        capture.text.includes(`"detectorId":"${detectorId}"`);
      if (capture.text.includes(detectorId) && !allowedHttpFieldError) {
        findings.push(
          `${capture.channel}:${capture.source}:safe_detector_id:forbidden`,
        );
      }
    }
  }
  return findings;
}

async function filesUnder(path: string): Promise<string[]> {
  const metadata = await stat(path);
  if (metadata.isFile()) return [path];
  const children = await readdir(path);
  return (
    await Promise.all(children.map((child) => filesUnder(resolve(path, child))))
  ).flat();
}

async function capturesFromArgs(args: string[]): Promise<Capture[]> {
  const captures: Capture[] = [];
  for (const argument of args) {
    const separator = argument.indexOf(":");
    if (separator < 1) throw new Error("capture must be CHANNEL:PATH");
    const channel = argument.slice(0, separator) as Channel;
    const path = argument.slice(separator + 1);
    if (
      ![
        "browser",
        "backend",
        "proxy",
        "appwrite",
        "container",
        "http_error",
        "otlp",
        "openobserve",
        "crash",
        "evidence",
      ].includes(channel)
    ) {
      throw new Error("capture channel is invalid");
    }
    if (path === "-") {
      captures.push({
        channel,
        source: "stdin",
        text: await readFile("/dev/stdin", "utf8"),
      });
      continue;
    }
    for (const file of await filesUnder(resolve(path))) {
      captures.push({
        channel,
        source: file,
        text: await readFile(file, "utf8"),
      });
    }
  }
  return captures;
}

function selfTest(): void {
  const channels: Channel[] = [
    "browser",
    "backend",
    "proxy",
    "appwrite",
    "container",
    "http_error",
    "otlp",
    "openobserve",
    "crash",
    "evidence",
  ];
  const safe = channels.map((channel) => ({
    channel,
    source: "self-test-safe",
    text:
      channel === "http_error"
        ? '{"code":"PRIVACY_INPUT_REJECTED","fieldErrors":[{"detectorId":"B1_PAN_LUHN"}]}'
        : '{"operation":"create_rejected","count":1}',
  }));
  if (scan(safe).length !== 0) throw new Error("scanner rejected safe capture");

  for (const channel of channels) {
    for (const canary of corpus.entries) {
      for (const variant of variants(canary)) {
        const findings = scan([
          {
            channel,
            source: "self-test-leak",
            text: `prefix:${variant.value}:suffix`,
          },
        ]);
        if (findings.length === 0)
          throw new Error("scanner missed synthetic leak");
      }
    }
  }
  if (
    scan([
      {
        channel: "evidence",
        source: "self-test-detector",
        text: "B1_PAN_LUHN",
      },
    ]).length === 0
  ) {
    throw new Error("scanner missed forbidden detector diagnostic");
  }
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--self-test") {
  selfTest();
  process.stdout.write(
    "Privacy scanner self-test passed across 10 capture channels\n",
  );
} else {
  const captures = await capturesFromArgs(args);
  const findings = scan(captures);
  if (findings.length > 0) {
    for (const finding of findings)
      process.stderr.write(`privacy finding ${finding}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      `Privacy scan passed for ${captures.length} captures\n`,
    );
  }
}
