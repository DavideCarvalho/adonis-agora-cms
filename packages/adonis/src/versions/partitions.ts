import type { CmsKnex } from '../db/types.js';
import { exec, ident } from '../repository/sql.js';
import type { SchemaSpec } from '../schema/types.js';

export type PartitionOptions = {
  /** First month to materialise. Defaults to the current month. */
  from?: Date;
  /** How many months ahead to create. Defaults to `3`. */
  monthsAhead?: number;
  /** Drop partitions older than this many months. `undefined` keeps everything. */
  retentionMonths?: number;
};

export type PartitionPlan = {
  name: string;
  /** Inclusive lower bound, exclusive upper bound (YYYY-MM-DD). */
  from: string;
  to: string;
};

/**
 * Monthly partition plan for `cms_versions`.
 *
 * Partitioning is a Postgres feature; the plan is produced as plain data so it can be reviewed
 * and embedded in a migration, and `ensureVersionPartitions` only executes it on Postgres.
 */
export function versionPartitionPlan(options: PartitionOptions = {}): PartitionPlan[] {
  const monthsAhead = Math.max(1, options.monthsAhead ?? 3);
  const start = options.from ?? new Date();
  const base = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const plans: PartitionPlan[] = [];

  for (let index = 0; index < monthsAhead; index += 1) {
    const begin = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + index, 1));
    const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + index + 1, 1));
    plans.push({
      name: suffix(begin),
      from: isoDate(begin),
      to: isoDate(end),
    });
  }

  return plans;
}

/** `CREATE TABLE ... PARTITION OF` statements for the plan. */
export function versionPartitionDdl(spec: SchemaSpec, options: PartitionOptions = {}): string[] {
  const parent = ident(`${spec.tablePrefix}versions`, spec.engine);

  return versionPartitionPlan(options).map(
    (plan) =>
      `CREATE TABLE IF NOT EXISTS ${ident(`${spec.tablePrefix}versions_${plan.name}`, spec.engine)} PARTITION OF ${parent} FOR VALUES FROM ('${plan.from}') TO ('${plan.to}')`,
  );
}

/** Drops partitions older than the retention window. */
export function versionPartitionDropDdl(
  spec: SchemaSpec,
  options: PartitionOptions = {},
): string[] {
  const months = options.retentionMonths;
  if (!months || months < 1) return [];

  const start = options.from ?? new Date();
  const base = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const statements: string[] = [];

  for (let index = 1; index <= months; index += 1) {
    const month = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - index, 1));
    statements.push(
      `DROP TABLE IF EXISTS ${ident(`${spec.tablePrefix}versions_${suffix(month)}`, spec.engine)}`,
    );
  }

  return statements;
}

/**
 * Applies the plan. No-op outside Postgres, because SQLite/MySQL have no declarative
 * partitioning — the docs are explicit about that instead of pretending otherwise.
 */
export async function ensureVersionPartitions(
  client: CmsKnex,
  spec: SchemaSpec,
  options: PartitionOptions = {},
): Promise<{ applied: number; skipped: boolean }> {
  if (spec.engine !== 'pg') return { applied: 0, skipped: true };

  const statements = [
    ...versionPartitionDdl(spec, options),
    ...versionPartitionDropDdl(spec, options),
  ];

  for (const statement of statements) {
    await exec(client, statement);
  }

  return { applied: statements.length, skipped: false };
}

function suffix(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}_${month}`;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
