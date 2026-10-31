import type {
  AdminDocument,
  AdminSchema,
  CmsUpload,
  DocumentSchedule,
  ListQuery,
  ListResult,
  VersionRecord,
} from './types.js';

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

  async create(
    slug: string,
    data: AdminDocument,
    options: { draft?: boolean } = {},
  ): Promise<AdminDocument> {
    const suffix = options.draft ? '?draft=true' : '';
    return this.request<AdminDocument>('POST', `/collections/${slug}${suffix}`, data);
  }

  async update(
    slug: string,
    id: string,
    data: AdminDocument,
    options: { autosave?: boolean; draft?: boolean } = {},
  ): Promise<AdminDocument> {
    const suffix = options.autosave ? '?autosave=true' : options.draft ? '?draft=true' : '';
    return this.request<AdminDocument>('PATCH', `/collections/${slug}/${id}${suffix}`, data);
  }

  async delete(slug: string, id: string, options: { force?: boolean } = {}): Promise<void> {
    const suffix = options.force ? '?force=true' : '';
    await this.request<void>('DELETE', `/collections/${slug}/${id}${suffix}`);
  }

  async restore(slug: string, id: string): Promise<AdminDocument> {
    return this.request<AdminDocument>('POST', `/collections/${slug}/${id}/restore`);
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

  async discardDraft(slug: string, id: string): Promise<AdminDocument> {
    return this.request<AdminDocument>('POST', `/collections/${slug}/${id}/discard-draft`);
  }

  async version(slug: string, id: string, version: number): Promise<VersionRecord> {
    return this.request('GET', `/collections/${slug}/${id}/versions/${version}?snapshot=true`);
  }

  /** Advisory: the server answers 409 when another user holds the document. */
  async lock(slug: string, id: string, ttlSeconds: number): Promise<void> {
    await this.request('POST', `/collections/${slug}/${id}/lock`, { ttlSeconds });
  }

  async unlock(slug: string, id: string): Promise<void> {
    await this.request('DELETE', `/collections/${slug}/${id}/lock`);
  }

  async scheduled(slug: string, id: string): Promise<{ schedule: DocumentSchedule | null }> {
    return this.request('GET', `/collections/${slug}/${id}/schedule`);
  }

  async schedule(
    slug: string,
    id: string,
    schedule: { at: string; action: string },
  ): Promise<void> {
    await this.request('POST', `/collections/${slug}/${id}/schedule`, schedule);
  }

  async unschedule(slug: string, id: string): Promise<void> {
    await this.request('DELETE', `/collections/${slug}/${id}/schedule`);
  }

  async restoreVersion(slug: string, id: string, version: number): Promise<AdminDocument> {
    return this.request<AdminDocument>(
      'POST',
      `/collections/${slug}/${id}/versions/${version}/restore`,
    );
  }

  async previewToken(
    slug: string,
    id: string,
  ): Promise<{ token: string; url: string; expiresIn: number }> {
    return this.request('GET', `/collections/${slug}/${id}/preview-token`);
  }

  /**
   * Uploads one file through `POST {baseUrl}/uploads` and returns the stored asset. Only
   * available when the app configured `cms.uploads.handler`; otherwise the endpoint is absent
   * and the dropzone stays disabled.
   */
  async upload(
    file: File,
    options: { field?: string; collection?: string } = {},
  ): Promise<CmsUpload> {
    const query = new URLSearchParams();
    if (options.field) query.set('field', options.field);
    if (options.collection) query.set('collection', options.collection);
    const search = query.toString();

    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.headers) Object.assign(headers, await this.headers());

    const body = new FormData();
    body.append('file', file, file.name);

    const response = await this.fetchImpl(`${this.baseUrl}/uploads${search ? `?${search}` : ''}`, {
      method: 'POST',
      headers,
      body,
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new CmsApiError(response.status, payload);

    return payload as CmsUpload;
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
