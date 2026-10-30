import knexFactory, { type Knex } from 'knex';
import type { CmsKnex } from '../../src/db/types.js';

/** In-memory SQLite client for integration tests. */
export function sqliteClient(): Knex {
  return knexFactory({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }) as Knex;
}

/** The core accepts a structural slice of Knex; a real instance satisfies it at runtime. */
export function asCmsKnex(client: Knex): CmsKnex {
  return client as unknown as CmsKnex;
}
