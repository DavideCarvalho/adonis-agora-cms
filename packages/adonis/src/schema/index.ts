export type { CompileOptions } from './compile.js';
export { compileSchema, hasLocalizedDescendant, indexName } from './compile.js';
export { canonicalJson, hashSchema } from './hash.js';
export { buildQueryPlan } from './query_plan.js';
export type {
  ColumnDefault,
  ColumnSpec,
  ColumnType,
  Engine,
  ForeignKeyRef,
  IdKind,
  IndexSpec,
  QueryPlanEntry,
  SchemaSpec,
  TableKind,
  TableSpec,
} from './types.js';
export { tableDepth } from './types.js';
