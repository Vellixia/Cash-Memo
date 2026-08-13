import { spawnSync } from "node:child_process";

const artifact = process.argv[2];
const image = process.argv[3];
const expectedUsers = {
  pgbackrest: "10002:10002",
  runtime: "10001:10001",
  verifier: "10003:10003",
};
if (
  !Object.hasOwn(expectedUsers, artifact) ||
  !/^cashmemo-[a-z]+:[0-9a-f]{40}$/u.test(image ?? "")
) {
  process.stderr.write("IMAGE_PROBE_ARGUMENT_INVALID\n");
  process.exit(64);
}

function docker(arguments_) {
  const result = spawnSync("docker", arguments_, { encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error("IMAGE_PROBE_COMMAND_FAILED");
  return result.stdout.trim();
}

try {
  const user = docker(["image", "inspect", "--format", "{{.Config.User}}", image]);
  if (user !== expectedUsers[artifact]) throw new Error("IMAGE_PROBE_USER_MISMATCH");

  const metadata = JSON.parse(docker(["image", "inspect", "--format", "{{json .Config}}", image]));
  if (!metadata.Labels?.["org.opencontainers.image.revision"]) {
    throw new Error("IMAGE_PROBE_REVISION_MISSING");
  }
  if (
    artifact === "runtime" &&
    !metadata.Healthcheck?.Test?.includes("/usr/local/lib/cashmemo/runtime-healthcheck.mjs")
  ) {
    throw new Error("IMAGE_PROBE_HEALTHCHECK_MISSING");
  }

  docker([
    "run",
    "--rm",
    "--read-only",
    "--entrypoint",
    "node",
    image,
    "--input-type=module",
    "--eval",
    `import {access,writeFile} from "node:fs/promises";
     if (process.getuid() !== ${Number(expectedUsers[artifact].split(":")[0])}) process.exit(2);
     try { await writeFile("/cashmemo-root-write-probe", "blocked"); process.exit(3); } catch {}
     if ("${artifact}" === "runtime") {
       try { await access("/workspace/server/node_modules/@cashmemo/test-support"); process.exit(4); } catch {}
     }`,
  ]);
  process.stdout.write(`IMAGE_RUNTIME_PROBE=PASS artifact=${artifact}\n`);
} catch (error) {
  const code =
    error instanceof Error && /^[A-Z_]+$/u.test(error.message)
      ? error.message
      : "IMAGE_PROBE_FAILED";
  process.stderr.write(`IMAGE_RUNTIME_PROBE=FAIL artifact=${artifact} code=${code}\n`);
  process.exitCode = 1;
}
