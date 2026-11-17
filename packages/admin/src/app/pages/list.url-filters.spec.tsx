import type { AdminCollection, AdminSchema } from '@adonis-agora/cms-react';
import { type AdminClient, CmsProvider, ConfirmProvider } from '@adonis-agora/cms-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NuqsHashAdapter } from '../../agora-kit/url-state/nuqs-hash-adapter';
import { ToastProvider } from '../toast.js';
import {
  ListView,
  readDateRanges,
  readFieldFilters,
  writeDateRanges,
  writeFieldFilters,
} from './list.js';

const POSTS: AdminCollection = {
  slug: 'posts',
  kind: 'collection',
  versioned: false,
  drafts: true,
  admin: { useAsTitle: 'title' },
  fields: [
    { name: 'title', type: 'text' },
    {
      name: 'category',
      type: 'select',
      options: [
        { label: 'News', value: 'news' },
        { label: 'Guides', value: 'guides' },
      ],
    },
    { name: 'publishedAt', type: 'date' },
  ],
};

const SCHEMA = {
  user: { id: 1 },
  collections: [POSTS],
  globals: [],
  permissions: { posts: { read: true, create: true, update: true, delete: true } },
} as unknown as AdminSchema;

function renderList() {
  const list = vi.fn(async (_slug: string, query: { page?: number }) => ({
    data: [],
    meta: { total: 60, perPage: 20, currentPage: query.page ?? 1, lastPage: 3, firstPage: 1 },
  }));
  const client = { list } as unknown as AdminClient;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <NuqsHashAdapter>
      <QueryClientProvider client={queryClient}>
        <CmsProvider client={client}>
          <ToastProvider>
            <ConfirmProvider>
              <ListView collection={POSTS} schema={SCHEMA} onNavigate={() => {}} />
            </ConfirmProvider>
          </ToastProvider>
        </CmsProvider>
      </QueryClientProvider>
    </NuqsHashAdapter>,
  );
  return list;
}

type Query = { page?: number; sort?: string; filter?: Record<string, unknown> };
const lastQuery = (list: ReturnType<typeof renderList>) =>
  (list.mock.calls.at(-1)?.[1] ?? {}) as Query;

describe('the list: filters in the URL', () => {
  it('opens filtered, searched, sorted and paged from a shared link', async () => {
    window.history.replaceState(
      null,
      '',
      '/admin#/collections/posts?q=launch&status=draft&f=category:news&d=publishedAt:2026-01-01:&sort=-title&page=2',
    );
    const list = renderList();
    await waitFor(() => expect(list).toHaveBeenCalled());
    const query = lastQuery(list);
    expect(query.page).toBe(2);
    expect(query.sort).toBe('-title');
    expect(query.filter).toEqual({
      title: { iContains: 'launch' },
      _status: { equals: 'draft' },
      category: { equals: 'news' },
      publishedAt: { gte: '2026-01-01' },
    });
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe('launch');
    expect((screen.getByRole('combobox', { name: 'Category' }) as HTMLSelectElement).value).toBe(
      'news',
    );
  });

  it('a filter pick pushes and goes back to page 1; back restores it', async () => {
    window.history.replaceState(null, '', '/admin?tenant=acme#/collections/posts?page=2');
    const list = renderList();
    await waitFor(() => expect(lastQuery(list).page).toBe(2));
    const start = window.history.length;

    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), {
      target: { value: 'guides' },
    });
    await waitFor(() => expect(window.location.hash).toBe('#/collections/posts?f=category:guides'));
    expect(window.location.search).toBe('?tenant=acme');
    expect(window.history.length).toBe(start + 1);
    await waitFor(() => expect(lastQuery(list).filter).toEqual({ category: { equals: 'guides' } }));

    act(() => window.history.back());
    await waitFor(() => expect(window.location.hash).toBe('#/collections/posts?page=2'));
    await waitFor(() =>
      expect((screen.getByRole('combobox', { name: 'Category' }) as HTMLSelectElement).value).toBe(
        '',
      ),
    );
  });

  it('typing the search replaces the entry once it settles', async () => {
    window.history.replaceState(null, '', '/admin#/collections/posts');
    const list = renderList();
    await waitFor(() => expect(list).toHaveBeenCalled());
    const start = window.history.length;
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'launch' } });
    await waitFor(() => expect(window.location.hash).toBe('#/collections/posts?q=launch'));
    expect(window.history.length).toBe(start);
  });
});

describe('field filter / date range params', () => {
  it('round-trip, keeping colons in values and dropping empty ones', () => {
    expect(readFieldFilters(['category:news', 'url:https://x', 'bad'])).toEqual({
      category: 'news',
      url: 'https://x',
    });
    expect(writeFieldFilters({ category: 'news', tag: '' })).toEqual(['category:news']);
    expect(writeFieldFilters({ tag: '' })).toBeNull();
    expect(readDateRanges(['publishedAt::2026-02-01'])).toEqual({
      publishedAt: { to: '2026-02-01' },
    });
    expect(writeDateRanges({ publishedAt: { from: '2026-01-01' } })).toEqual([
      'publishedAt:2026-01-01:',
    ]);
    expect(writeDateRanges({ publishedAt: {} })).toBeNull();
  });
});
