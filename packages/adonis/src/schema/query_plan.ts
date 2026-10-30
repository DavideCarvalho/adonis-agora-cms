import type { QueryPlanEntry, TableSpec } from './types.js';

/**
 * Builds the logical-path → physical-location index.
 *
 * The repository, the REST layer and the `filter` integration never need to know how arrays
 * and blocks are stored: they resolve `layout.gallery.caption` here and get the table, the
 * column and the join chain.
 */
export function buildQueryPlan(tables: readonly TableSpec[]): Record<string, QueryPlanEntry> {
  const plan: Record<string, QueryPlanEntry> = {};

  for (const table of tables) {
    const isChild = table.kind === 'child';

    for (const column of table.columns) {
      if (!column.path) continue;
      if (column.name.startsWith('_')) continue;

      const existing = plan[column.path];

      if (!existing) {
        plan[column.path] = {
          table: table.name,
          rootTable: isChild ? (table.rootTable ?? table.name) : table.name,
          chain: isChild ? [...(table.chain ?? [])] : [],
          column: column.name,
          path: column.path.split('.'),
          ...(column.locale ? { columns: { [column.locale]: column.name } } : {}),
        };
        continue;
      }

      if (existing.table === table.name && column.locale) {
        existing.columns = { ...(existing.columns ?? {}), [column.locale]: column.name };
      }
    }
  }

  return plan;
}
