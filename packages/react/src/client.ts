import type { AdminDocument, AdminSchema, ListQuery, ListResult, VersionRecord } from './types.js';

export class CmsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string> | undefined;

  constructor(status: number, body: unknown) {
    const error = (
      body as { error?: { code?: string; message?: string; fields?: Record<string, string> } }
    )?.error;
    super(error?.message ?? `Request failed with status ${status}`);
    this.name = 'CmsApiError';
    this.status = status;
    this.code = error?.code ?? 'CMS_HTTP';
    this.fields = error?.fields;
  }
}

export type AdminClientOptions = {
  /** REST base, e.g. `/api/cms`. */
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
};

/** Thin typed client over the CMS REST surface. No React, no query cache. */
export class AdminClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: AdminClientOptions['headers'];

  constructor(options: AdminClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api/cms';
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.headers = options.headers;
  }

  async schema(): Promise<AdminSchema> {
    return this.request<AdminSchema>('GET', '/schema');
  }

  async list(slug: string, query: ListQuery = {}): Promise<ListResult> {
    return this.request<ListResult>('GET', `/collections/${slug}${toSearchParams(query)}`);
  }

  async find(slug: string, id: string, query: ListQuery = {}): Promise<AdminDocument> {
    return this.request<AdminDocument>('GET', `/collections/${slug}/${id}${toSearchParams(query)}`);
  }

  async create(slug: string, data: AdminDocument): Promise<AdminDocument> {
    return this.request<AdminDocument>('POST', `/collections/${slug}`, data);
  }

  async update(slug: string, id: string, data: AdminDocument): Promise<AdminDocument> {
    return this.request<AdminDocument>('PATCH', `/collections/${slug}/${id}`, data);
  }

  async delete(slug: string, id: string): Promise<void> {
    await this.request<void>('DELETE', `/collections/${slug}/${id}`);
  }

  async publish(slug: string, id: string): Promise<AdminDocument> {
    return this.request<AdminDocument>('POST', `/collections/${slug}/${id}/publish`);
  }

  async unpublish(slug: string, id: string): Promise<AdminDocument> {
    return this.request<AdminDocument>('POST', `/collections/${slug}/${id}/unpublish`);
  }

  async versions(slug: string, id: string): Promise<{ docs: VersionRecord[]; totalDocs: number }> {
    return this.request('GET', `/collections/${slug}/${id}/versions`);
  }

  async restoreVersion(slug: string, id: string, version: number): Promise<AdminDocument> {
    return this.request<AdminDocument>(
      'POST',
      `/collections/${slug}/${id}/versions/${version}/restore`,
    );
  }

  async global(slug: string): Promise<AdminDocument> {
    return this.request<AdminDocument>('GET', `/globals/${slug}`);
  }

  async updateGlobal(slug: string, data: AdminDocument): Promise<AdminDocument> {
    return this.request<AdminDocument>('PATCH', `/globals/${slug}`, data);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.headers) Object.assign(headers, await this.headers());

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (response.status === 204) return undefined as T;

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new CmsApiError(response.status, payload);

    return payload as T;
  }
}

function toSearchParams(query: ListQuery): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (key === 'where') {
      for (const [field, condition] of Object.entries(value as Record<string, unknown>)) {
        if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
          for (const [operator, operand] of Object.entries(condition as Record<string, unknown>)) {
            params.set(`where[${field}][${operator}]`, String(operand));
          }
          continue;
        }
        params.set(`where[${field}][equals]`, String(condition));
      }
      continue;
    }

    params.set(key, String(value));
  }

  const search = params.toString();
  return search ? `?${search}` : '';
}
