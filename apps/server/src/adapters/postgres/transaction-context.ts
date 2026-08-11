import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface AccountTransaction {
  readonly authenticatedAccountId: string;
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

class PostgresAccountTransaction implements AccountTransaction {
  constructor(
    private readonly client: PoolClient,
    readonly authenticatedAccountId: string,
  ) {}

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<QueryResult<Row>> {
    return this.client.query<Row>(text, [...values]);
  }
}

function assertAuthenticatedAccountId(accountId: string): void {
  if (!CANONICAL_UUID.test(accountId)) throw new Error("INVALID_AUTHENTICATED_ACCOUNT_ID");
}

export async function withAccountTransaction<Result>(
  pool: Pool,
  authenticatedAccountId: string,
  operation: (transaction: AccountTransaction) => Promise<Result>,
  options: Readonly<{ isolationLevel?: "repeatable read" }> = {},
): Promise<Result> {
  assertAuthenticatedAccountId(authenticatedAccountId);
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    if (options.isolationLevel === "repeatable read") {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    }
    const context = await client.query<{ account_id: string | null }>(
      "SELECT set_config('app.current_user_id', $1, true) AS account_id",
      [authenticatedAccountId],
    );
    if (context.rows[0]?.account_id !== authenticatedAccountId) {
      throw new Error("ACCOUNT_CONTEXT_NOT_ESTABLISHED");
    }

    const result = await operation(new PostgresAccountTransaction(client, authenticatedAccountId));
    await client.query("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "ACCOUNT_TRANSACTION_AND_ROLLBACK_FAILED",
          {
            cause: rollbackError,
          },
        );
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
