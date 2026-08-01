import { readFile } from "node:fs/promises";

type Column = {
  key: string;
  kind: "varchar" | "text" | "integer" | "enum";
  required: boolean;
  size?: number;
  min?: number;
  max?: number;
  elements?: string[];
  default?: string | number | null;
};

type Index = {
  key: string;
  type: "key" | "unique";
  columns: string[];
  orders: Array<"ASC" | "DESC">;
};

type Table = {
  id: string;
  name: string;
  permissions: string[];
  rowSecurity: boolean;
  columns: Column[];
  indexes: Index[];
};

type Schema = {
  database: { id: string; name: string; enabled: boolean };
  tables: Table[];
};

const endpoint = required("APPWRITE_ENDPOINT").replace(/\/$/, "");
const project = required("APPWRITE_PROJECT_ID");
const key = required("APPWRITE_SERVER_API_KEY");
const schema = JSON.parse(
  await readFile(new URL("./schema.json", import.meta.url), "utf8"),
) as Schema;

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`required runtime configuration missing: ${name}`);
  return value;
}

async function request(
  path: string,
  operation: string,
  init: RequestInit = {},
) {
  const response = await fetch(`${endpoint}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Appwrite-Project": project,
      "X-Appwrite-Key": key,
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`${operation} failed with HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function exists(path: string): Promise<boolean> {
  const response = await fetch(`${endpoint}${path}`, {
    headers: { "X-Appwrite-Project": project, "X-Appwrite-Key": key },
    cache: "no-store",
  });
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(
      `supported Appwrite existence check failed with HTTP ${response.status}`,
    );
  return true;
}

async function ensureDatabase() {
  if (await exists(`/tablesdb/${schema.database.id}`)) return;
  await request("/tablesdb", "create database", {
    method: "POST",
    body: JSON.stringify({
      databaseId: schema.database.id,
      name: schema.database.name,
      enabled: schema.database.enabled,
    }),
  });
}

async function ensureTable(table: Table) {
  const base = `/tablesdb/${schema.database.id}/tables/${table.id}`;
  if (!(await exists(base))) {
    await request(`/tablesdb/${schema.database.id}/tables`, "create table", {
      method: "POST",
      body: JSON.stringify({
        tableId: table.id,
        name: table.name,
        permissions: table.permissions,
        rowSecurity: table.rowSecurity,
        enabled: true,
      }),
    });
  }
  for (const column of table.columns) await ensureColumn(table.id, column);
  for (const index of table.indexes) await ensureIndex(table.id, index);
}

async function ensureColumn(tableId: string, column: Column) {
  const base = `/tablesdb/${schema.database.id}/tables/${tableId}/columns`;
  if (await exists(`${base}/${column.key}`)) return;
  const body: Record<string, unknown> = {
    key: column.key,
    required: column.required,
    array: false,
  };
  if (column.default !== undefined) body.default = column.default;
  if (column.size !== undefined) body.size = column.size;
  if (column.min !== undefined) body.min = column.min;
  if (column.max !== undefined) body.max = column.max;
  if (column.elements !== undefined) body.elements = column.elements;
  await request(`${base}/${column.kind}`, "create column", {
    method: "POST",
    body: JSON.stringify(body),
  });
  await pollAvailable(`${base}/${column.key}`, "column availability");
}

async function ensureIndex(tableId: string, index: Index) {
  const base = `/tablesdb/${schema.database.id}/tables/${tableId}/indexes`;
  if (await exists(`${base}/${index.key}`)) return;
  await request(base, "create index", {
    method: "POST",
    body: JSON.stringify(index),
  });
  await pollAvailable(`${base}/${index.key}`, "index availability");
}

async function pollAvailable(path: string, operation: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const resource = await request(path, operation);
    if (resource.status === "available") return;
    if (resource.status === "failed")
      throw new Error(`${operation} entered failed state`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${operation} timed out`);
}

await ensureDatabase();
for (const table of schema.tables) await ensureTable(table);
process.stdout.write(
  "Appwrite schema provisioned through supported TablesDB APIs\n",
);
