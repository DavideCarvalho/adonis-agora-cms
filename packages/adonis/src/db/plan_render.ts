import type { SchemaPlan } from './types.js';
import { planIsEmpty } from './types.js';

/** Human-readable plan, used by `cms:diff` and `cms:sync --dry-run`. */
export function renderPlan(plan: SchemaPlan): string {
  const lines: string[] = [];

  if (planIsEmpty(plan)) return 'Schema is up to date.';

  if (plan.destructive) {
    lines.push('! plan contains destructive changes');
    lines.push('');
  }

  if (plan.creates.length > 0) {
    lines.push('create');
    for (const table of plan.creates) {
      lines.push(`  + ${table.name} (${table.kind})`);
      for (const column of table.columns) {
        lines.push(`      ${describeColumn(column)}`);
      }
      for (const index of table.indexes) {
        lines.push(
          `      index ${index.name} (${index.columns.join(', ')})${index.unique ? ' unique' : ''}`,
        );
      }
    }
    lines.push('');
  }

  if (plan.alters.length > 0) {
    lines.push('alter');
    for (const alter of plan.alters) {
      if (
        alter.addColumns.length === 0 &&
        alter.dropColumns.length === 0 &&
        alter.alterColumns.length === 0 &&
        alter.addIndexes.length === 0 &&
        alter.dropIndexes.length === 0 &&
        alter.renames.length === 0
      ) {
        continue;
      }

      lines.push(`  ~ ${alter.table}`);

      for (const rename of alter.renames) {
        lines.push(`      ↻ ${rename.from} → ${rename.to}`);
      }
      for (const column of alter.addColumns) {
        lines.push(`      + ${describeColumn(column)}`);
      }
      for (const column of alter.dropColumns) {
        lines.push(`      - ${column}`);
      }
      for (const column of alter.alterColumns) {
        lines.push(
          `      ~ ${column.column}: ${describeType(column.from)} → ${describeType(column.to)}`,
        );
      }
      for (const index of alter.addIndexes) {
        lines.push(
          `      index+ ${index.name} (${index.columns.join(', ')})${index.unique ? ' unique' : ''}`,
        );
      }
      for (const index of alter.dropIndexes) {
        lines.push(`      index- ${index}`);
      }
    }
    lines.push('');
  }

  if (plan.drops.length > 0) {
    lines.push('drop');
    for (const name of plan.drops) lines.push(`  - ${name}`);
    lines.push('');
  }

  if (plan.warnings.length > 0) {
    lines.push('warnings');
    for (const warning of plan.warnings) lines.push(`  ! ${warning}`);
  }

  return lines.join('\n').trimEnd();
}

function describeColumn(column: SchemaPlan['creates'][number]['columns'][number]): string {
  return `${column.name} ${describeType(column)}`;
}

function describeType(column: {
  type: string;
  length?: number | undefined;
  precision?: number | undefined;
  scale?: number | undefined;
  nullable: boolean;
}): string {
  let value = column.type;
  if (column.length) value += `(${column.length})`;
  if (column.precision !== undefined && column.scale !== undefined) {
    value += `(${column.precision},${column.scale})`;
  }
  if (column.nullable === false) value += ' not null';
  return value;
}

/** Non-zero when the plan has drift or destructive changes, so CI can gate on it. */
export function planExitCode(plan: SchemaPlan): number {
  if (plan.destructive) return 2;
  if (!planIsEmpty(plan)) return 1;
  return 0;
}
