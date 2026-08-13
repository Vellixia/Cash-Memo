import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const VERSION = "1.12.5";
const CHECKSUMS = Object.freeze({
  "darwin-arm64": "dbb5a5bae9b0cabf622cd81a80ea02230eae8a3813215400df41a2cb89b47157",
  "linux-arm64": "528f4eea63452bbddb30fa4f1780b57fac8d7676f9dda0f772e847bb62c1260a",
  "linux-x64": "dade9650e6b74fc7a8b986bd8717497d32f9e09cf82e479afef4977fa3085536",
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const targetDirectory = resolve(root, ".cache/opentofu", VERSION);
const binary = resolve(targetDirectory, "tofu");
const key = `${platform()}-${arch()}`;
const checksum = CHECKSUMS[key];

if (!checksum) throw new Error("OPENTOFU_PLATFORM_UNSUPPORTED");

async function validBinary() {
  try {
    const output = execFileSync(binary, ["version"], { encoding: "utf8" });
    return output.startsWith(`OpenTofu v${VERSION}`);
  } catch {
    return false;
  }
}

if (!(await validBinary())) {
  const platformName = platform() === "darwin" ? "darwin" : "linux";
  const architecture = arch() === "x64" ? "amd64" : "arm64";
  const archiveName = `tofu_${VERSION}_${platformName}_${architecture}.zip`;
  const url = `https://github.com/opentofu/opentofu/releases/download/v${VERSION}/${archiveName}`;
  const temporary = resolve(targetDirectory, `${archiveName}.partial`);
  await mkdir(targetDirectory, { recursive: true });
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error("OPENTOFU_DOWNLOAD_FAILED");
  await writeFile(temporary, Buffer.from(await response.arrayBuffer()));
  const actual = createHash("sha256")
    .update(await readFile(temporary))
    .digest("hex");
  if (actual !== checksum) {
    await rm(temporary, { force: true });
    throw new Error("OPENTOFU_CHECKSUM_MISMATCH");
  }
  const extractDirectory = resolve(targetDirectory, "extract");
  await rm(extractDirectory, { force: true, recursive: true });
  await mkdir(extractDirectory, { recursive: true });
  execFileSync("unzip", ["-q", temporary, "-d", extractDirectory]);
  await rename(resolve(extractDirectory, "tofu"), binary);
  await chmod(binary, 0o755);
  await rm(extractDirectory, { force: true, recursive: true });
  await rm(temporary, { force: true });
}

process.stdout.write(`${binary}\n`);
