import postgres from 'postgres';

/** The few database calls the service needs. Works the same on Postgres (production) and PGlite (tests). */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` in one transaction: all of it is saved, or none of it. */
  tx<R>(fn: (db: Db) => Promise<R>): Promise<R>;
}

type Sql = postgres.Sql | postgres.TransactionSql;

function fromPostgres(sql: Sql): Db {
  return {
    query: async (text, params = []) => (await sql.unsafe(text, params as postgres.ParameterOrJSON<never>[])) as never,
    tx: (fn) => (sql as postgres.Sql).begin((t) => fn(fromPostgres(t))) as never,
  };
}

/** Production: a connection through Cloudflare Hyperdrive. */
export function postgresDb(connectionString: string): Db {
  // prepare: false because Hyperdrive pools connections.
  return fromPostgres(postgres(connectionString, { prepare: false, max: 5 }));
}
