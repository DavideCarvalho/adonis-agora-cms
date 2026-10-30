/**
 * The CMS error hierarchy.
 *
 * Every error carries a stable `code` so HTTP handlers, CLI output and tests can branch on it
 * without matching on messages. `context` is structured metadata (paths, table names, field
 * names) and must never contain user content.
 */
export class CmsError extends Error {
  readonly code: string;
  readonly context: Record<string, unknown>;

  constructor(code: string, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.context = context;
  }
}

/** Invalid CMS configuration. Accumulated by `validateConfig` and thrown at boot. */
export class CmsConfigError extends CmsError {
  readonly path: string;

  constructor(path: string, message: string) {
    super('CMS_CONFIG', `${path}: ${message}`, { path });
    this.path = path;
  }
}

/** The schema spec could not be compiled or applied (unsupported engine, invalid plan). */
export class CmsSchemaError extends CmsError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('CMS_SCHEMA', message, context);
  }
}

/** The database does not match the config hash. */
export class CmsSchemaDriftError extends CmsError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super('CMS_SCHEMA_DRIFT', message, context);
  }
}

/** Document validation failed. `fields` maps field path to message. */
export class CmsValidationError extends CmsError {
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>) {
    super('CMS_VALIDATION', 'Validation failed', { fields });
    this.fields = fields;
  }
}

export class CmsNotFoundError extends CmsError {
  constructor(message = 'Not found') {
    super('CMS_NOT_FOUND', message);
  }
}

export class CmsForbiddenError extends CmsError {
  constructor(message = 'Forbidden') {
    super('CMS_FORBIDDEN', message);
  }
}

export class CmsConflictError extends CmsError {
  constructor(message: string) {
    super('CMS_CONFLICT', message);
  }
}

/** A collection, field or global hook threw. Aborts the surrounding transaction. */
export class CmsHookError extends CmsError {
  constructor(hook: string, cause: unknown) {
    super('CMS_HOOK', `Hook "${hook}" failed: ${cause instanceof Error ? cause.message : cause}`);
  }
}
