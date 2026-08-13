const kind = process.argv[2] ?? "ready";
const role = process.env.PROCESS_ROLE;
const port = process.env.PORT;

if (!new Set(["live", "ready"]).has(kind) || !new Set(["api", "worker"]).has(role)) {
  process.exit(64);
}
if (port === undefined || !/^[0-9]{1,5}$/u.test(port)) process.exit(64);

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 4_000);
try {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/${kind}`, {
    signal: controller.signal,
  });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
} finally {
  clearTimeout(timer);
}
