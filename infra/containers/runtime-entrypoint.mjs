const role = process.argv[2] ?? process.env.PROCESS_ROLE;

const roles = Object.freeze({
  api: async () => {
    process.env.PROCESS_ROLE = "api";
    await import("/workspace/server/dist/src/bootstrap/main.js");
  },
  migrate: async () => {
    await import("/workspace/scripts/db/migrate-production.mjs");
  },
  worker: async () => {
    process.env.PROCESS_ROLE = "worker";
    await import("/workspace/server/dist/src/bootstrap/main.js");
  },
});

if (role === undefined || !Object.hasOwn(roles, role)) {
  process.stderr.write("CASHMEMO_RUNTIME_ROLE_INVALID\n");
  process.exit(64);
}

const imageRevision = process.env.CASHMEMO_IMAGE_REVISION;
if (imageRevision === undefined || !/^[0-9a-f]{40}$/u.test(imageRevision)) {
  process.stderr.write("CASHMEMO_RUNTIME_IMAGE_REVISION_INVALID\n");
  process.exit(70);
}
process.env.BUILD_VERSION = imageRevision;

try {
  await roles[role]();
} catch {
  process.stderr.write("CASHMEMO_RUNTIME_START_FAILED\n");
  process.exit(1);
}
