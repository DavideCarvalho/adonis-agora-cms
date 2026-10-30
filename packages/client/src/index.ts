export type ContentQuery = {
  where?: Record<string, unknown>;
  sort?: string;
  limit?: number;
  page?: number;
  depth?: number;
  locale?: string;
  select?: string;
};

export type ContentDocument = Record<string, unknown> & { id: string };

export type ContentList<T> = {
  docs: T[];
  totalDocs: number;
  limit: number;
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
};

export type ContentClientOptions = {
  baseUrl: string;
  /** App token. The tenant is bound to it server-side — the client never chooses it. */
  token?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

export class ContentClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, body: unknown) {
    const error = (body as { error?: { code?: string; message?: string } })?.error;
    super(error?.message ?? `Request failed with status ${status}`);
    this.name = 'ContentClientError';
    this.status = status;
    this.code = error?.code ?? 'CMS_HTTP';
  }
}

/**
 * Read-only client for a CMS server.
 *
 * Consumes the public REST surface; writes are intentionally absent because app tokens are
 * read-only unless they carry the `write` ability, and a content client should not.
 */
export function createContentClient<Collections extends string = string>(
  options: ContentClientOptions,
) {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function request<T>(path: string): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
    if (options.token) headers.authorization = `Bearer ${options.token}`;

    const response = await fetchImpl(`${baseUrl}${path}`, { headers });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new ContentClientError(response.status, payload);
    return payload as T;
  }

  return {
    collection<Slug extends Collections | string = string>(slug: Slug) {
      return {
        find<T extends ContentDocument = ContentDocument>(
          query: ContentQuery = {},
        ): Promise<ContentList<T>> {
          return request<ContentList<T>>(`/collections/${slug}${toSearch(query)}`);
        },

        findByID<T extends ContentDocument = ContentDocument>(
          id: string,
          query: Pick<ContentQuery, 'depth' | 'locale'> = {},
        ): Promise<T> {
          return request<T>(`/collections/${slug}/${id}${toSearch(query)}`);
        },
      };
    },

    global<Slug extends string = string>(slug: Slug) {
      return {
        get<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T> {
          return request<T>(`/globals/${slug}`);
        },
      };
    },
  };
}

export function toSearch(query: ContentQuery): string {
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
