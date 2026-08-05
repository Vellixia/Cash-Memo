import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";

const secretPath = "config/local-secrets/cashmemo.env";
const runtimePath = "config/local-secrets/appwrite-runtime.env";
const values = parseEnvironment(await readFile(secretPath, "utf8"));
const endpoint = required("APPWRITE_ENDPOINT")
  .replace("127.0.0.1", "localhost")
  .replace(/\/$/u, "");
const projectId = required("APPWRITE_PROJECT_ID");
const databaseId = required("APPWRITE_DATABASE_ID");
const email = required("APPWRITE_CONSOLE_EMAIL");
const password = required("APPWRITE_CONSOLE_PASSWORD");

await waitForHealth();
await allowConflict(() =>
  call("/account", "console", undefined, {
    method: "POST",
    body: {
      userId: "cashmemo-console-admin",
      email,
      password,
      name: "Cashmemo Local Admin",
    },
  }),
);
const sessionCookie = await createConsoleSession();

await allowConflict(() =>
  call("/teams", "console", sessionCookie, {
    method: "POST",
    body: { teamId: "cashmemo-local-team", name: "Cashmemo Local" },
  }),
);
await allowConflict(() =>
  call("/projects", "console", sessionCookie, {
    method: "POST",
    body: {
      projectId,
      name: "Cashmemo Test",
      teamId: "cashmemo-local-team",
      region: "default",
    },
  }),
);
const key = await call(`/projects/${projectId}/keys`, "console", sessionCookie, {
  method: "POST",
  body: {
    keyId: `key${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    name: "Cashmemo isolated test gate",
    scopes: [
      "databases.read",
      "databases.write",
      "tables.read",
      "tables.write",
      "columns.read",
      "columns.write",
      "indexes.read",
      "indexes.write",
      "rows.read",
      "rows.write",
      "users.read",
      "users.write",
      "sessions.write",
    ],
  },
});
const apiKey = stringField(key, "secret");
const temporary = `${runtimePath}.tmp`;
await writeFile(
  temporary,
  [`APPWRITE_SERVER_API_KEY=${apiKey}`, ""].join("\n"),
  { mode: 0o600 },
);
await rename(temporary, runtimePath);
await chmod(runtimePath, 0o600);
process.stdout.write(
  "Appwrite project and scoped server key bootstrapped through supported APIs\n",
);

function parseEnvironment(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator > 0)
      result.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return result;
}

function required(name: string): string {
  const value = values.get(name);
  if (value === undefined || value.length === 0)
    throw new Error(`required bootstrap configuration missing: ${name}`);
  return value;
}

async function waitForHealth(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${endpoint}/health/version`, {
        headers: { "X-Appwrite-Project": "console" },
        cache: "no-store",
      });
      if (response.ok) return;
    } catch {
      // Appwrite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Appwrite health gate timed out");
}

async function createConsoleSession(): Promise<string> {
  const response = await fetch(`${endpoint}/account/sessions/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": "console",
    },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      `supported Appwrite bootstrap request failed with HTTP ${response.status}`,
    );
  const headers = response.headers as Headers & {
    getSetCookie: () => string[];
  };
  const cookie = headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .filter((value): value is string => value !== undefined)
    .join("; ");
  if (cookie.length === 0)
    throw new Error("supported Appwrite session cookie unavailable");
  return cookie;
}

async function call(
  path: string,
  project: string,
  sessionCookie: string | undefined,
  options: Readonly<{ method: string; body: Record<string, unknown> }>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${endpoint}${path}`, {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": project,
      ...(sessionCookie === undefined
        ? {}
        : { Cookie: sessionCookie }),
    },
    body: JSON.stringify(options.body),
    cache: "no-store",
  });
  if (!response.ok) {
    const error = new Error(
      `supported Appwrite bootstrap request failed with HTTP ${response.status}`,
    ) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as Record<string, unknown>;
}

async function allowConflict(
  action: () => Promise<Record<string, unknown>>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof Error) || !("status" in error) || error.status !== 409)
      throw error;
  }
}

function stringField(value: Record<string, unknown>, name: string): string {
  const field = value[name];
  if (typeof field !== "string" || field.length === 0)
    throw new Error("supported Appwrite response missing required field");
  return field;
}
