import { createHash, randomBytes } from 'node:crypto';
import type { RepoContext } from '../repository/document.js';
import { exec, ident, selectOne, selectRows, sqlTimestamp } from '../repository/sql.js';

export type ApiTokenPrincipal = {
  id: number;
  name: string;
  tenant: string | null;
  abilities: readonly string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
};

export type CreateApiTokenOptions = {
  name: string;
  tenant?: string | null;
  abilities?: readonly string[];
  expiresAt?: Date | null;
};

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateApiToken(): { token: string; hash: string } {
  const token = `cms_${randomBytes(24).toString('base64url')}`;
  return { token, hash: hashApiToken(token) };
}

export async function createApiToken(
  ctx: RepoContext,
  options: CreateApiTokenOptions,
): Promise<string> {
  const table = `${ctx.spec.tablePrefix}api_tokens`;
  const { token, hash } = generateApiToken();
  const columns = ['name', 'token_hash', 'tenant', 'abilities', 'expires_at', 'created_at'];

  await exec(
    ctx.client,
    `insert into ${ident(table, ctx.engine)} (${columns.map((name) => ident(name, ctx.engine)).join(', ')}) values (?, ?, ?, ?, ?, ?)`,
    [
      options.name,
      hash,
      options.tenant ?? null,
      JSON.stringify(options.abilities ?? ['read']),
      options.expiresAt ? sqlTimestamp(options.expiresAt, ctx.engine) : null,
      sqlTimestamp(new Date(), ctx.engine),
    ],
  );

  return token;
}

export async function resolveApiToken(
  ctx: RepoContext,
  token: string,
  now = new Date(),
): Promise<ApiTokenPrincipal | null> {
  const table = `${ctx.spec.tablePrefix}api_tokens`;
  const row = await selectOne(
    ctx.client,
    `select * from ${ident(table, ctx.engine)} where ${ident('token_hash', ctx.engine)} = ? limit 1`,
    [hashApiToken(token)],
  );

  if (!row) return null;

  const expiresAt = row.expires_at ? new Date(String(row.expires_at)) : null;
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return null;

  await exec(
    ctx.client,
    `update ${ident(table, ctx.engine)} set ${ident('last_used_at', ctx.engine)} = ? where ${ident('id', ctx.engine)} = ?`,
    [sqlTimestamp(now, ctx.engine), row.id],
  );

  return toPrincipal(row);
}

export async function listApiTokens(ctx: RepoContext): Promise<ApiTokenPrincipal[]> {
  const table = `${ctx.spec.tablePrefix}api_tokens`;
  const rows = await selectRows(
    ctx.client,
    `select id, name, tenant, abilities, expires_at, last_used_at from ${ident(table, ctx.engine)} order by id desc`,
  );
  return rows.map(toPrincipal);
}

/** `read` is implied; `write` must be granted explicitly. */
export function tokenCan(principal: ApiTokenPrincipal, ability: 'read' | 'write'): boolean {
  return principal.abilities.includes(ability) || ability === 'read';
}

function toPrincipal(row: Record<string, unknown>): ApiTokenPrincipal {
  return {
    id: Number(row.id),
    name: String(row.name),
    tenant: row.tenant === null || row.tenant === undefined ? null : String(row.tenant),
    abilities: parseAbilities(row.abilities),
    expiresAt: row.expires_at ? new Date(String(row.expires_at)) : null,
    lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)) : null,
  };
}

function parseAbilities(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
