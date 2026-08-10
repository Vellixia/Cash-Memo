import { Pool } from "pg";

let identityPool: Pool | null = null;

export function getIdentityPool(): Pool {
  if (identityPool !== null) return identityPool;
  throw new Error("IDENTITY_POOL_NOT_INITIALIZED");
}

export function createIdentityPool(connectionString: string): Pool {
  if (identityPool !== null) return identityPool;
  identityPool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return identityPool;
}

export async function destroyIdentityPool(): Promise<void> {
  if (identityPool === null) return;
  await identityPool.end();
  identityPool = null;
}
