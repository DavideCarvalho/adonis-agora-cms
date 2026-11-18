import type { AdminCollection, AdminDocument, AdminSchema } from '@adonis-agora/cms-react';
import { type AdminClient, CmsProvider, ConfirmProvider } from '@adonis-agora/cms-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NuqsHashAdapter } from '../../agora-kit/url-state/nuqs-hash-adapter';
import { ToastProvider } from '../toast.js';
import { ListView } from './list.js';

const COUNTRIES = ['Brazil', 'Chile', 'Peru', 'Uruguay', 'Bolivia', 'Paraguay', 'Colombia'];

const POSTS: AdminCollection = {
  slug: 'posts',
  kind: 'collection',
  versioned: false,
  drafts: false,
  admin: { useAsTitle: 'title' },
  fields: [
    { name: 'title', type: 'text' },
    {
      name: 'country',
      type: 'select',
      options: COUNTRIES.map((label) => ({ label, value: label.toLowerCase() })),
    },
    { name: 'author', type: 'relation', relationTo: 'authors' },
  ],
};

const AUTHORS: AdminCollection = {
  slug: 'authors',
  kind: 'collection',
  versioned: false,
  drafts: false,
  admin: { useAsTitle: 'name' },
  fields: [{ name: 'name', type: 'text' }],
};

const SCHEMA = {
  collections: [POSTS, AUTHORS],
  globals: [],
  permissions: { posts: { read: true }, authors: { read: true } },
} as unknown as AdminSchema;

// 150 authors: more than the 100 a relation filter lists per page.
const ALL_AUTHORS: AdminDocument[] = Array.from({ length: 150 }, (_, i) => ({
  id: i + 1,
  name: `Author ${i + 1}`,
}));

type Query = { size?: number; filter?: Record<string, { iContains?: string }> };

function renderList() {
  const list = vi.fn(async (slug: string, query: Query) => {
    if (slug !== 'authors') {
      return {
        data: [],
        meta: { total: 0, perPage: 20, currentPage: 1, lastPage: 1, firstPage: 1 },
      };
    }
    const term = query.filter?.name?.iContains?.toLowerCase();
    const data = ALL_AUTHORS.filter(
      (doc) => !term || String(doc.name).toLowerCase().includes(term),
    ).slice(0, query.size ?? 20);
    return {
      data,
      meta: { total: data.length, perPage: 100, currentPage: 1, lastPage: 1, firstPage: 1 },
    };
  });
  const find = vi.fn(
    async (_slug: string, id: string) => ALL_AUTHORS.find((doc) => String(doc.id) === id)!,
  );
  const client = { list, find } as unknown as AdminClient;
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
  return { list, find };
}

async function type(input: HTMLElement, text: string) {
  await act(async () => {
    input.focus();
    // happy-dom input events don't open Base UI's popup; ArrowDown does (as it does for users).
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.change(input, { target: { value: text } });
    await new Promise((r) => setTimeout(r, 20));
  });
}

async function pick(name: RegExp | string) {
  const option = await screen.findByRole('option', { name });
  await act(async () => {
    fireEvent.click(option);
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('the list: combobox filters', () => {
  it('an option filter with many options is searchable and writes the URL', async () => {
    window.history.replaceState(null, '', '/admin#/collections/posts');
    renderList();
    const input = screen.getByRole('combobox', { name: 'Country' });
    expect(input.tagName).toBe('INPUT');
    await type(input, 'urug');
    expect(screen.queryByRole('option', { name: 'Brazil' })).toBeNull();
    await pick('Uruguay');
    await waitFor(() => expect(window.location.hash).toBe('#/collections/posts?f=country:uruguay'));
  });

  it('a relation filter searches the target on the server, past the first page', async () => {
    window.history.replaceState(null, '', '/admin#/collections/posts');
    const { list } = renderList();
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith('authors', expect.objectContaining({ size: 100 })),
    );
    // Let the first page land before typing.
    await act(() => new Promise((r) => setTimeout(r, 50)));
    await type(screen.getByRole('combobox', { name: 'Author' }), 'Author 142');
    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        'authors',
        expect.objectContaining({ filter: { name: { iContains: 'Author 142' } } }),
      ),
    );
    await pick('Author 142');
    await waitFor(() => expect(window.location.hash).toBe('#/collections/posts?f=author:142'));
  });

  it('a relation value outside the first page shows its label', async () => {
    window.history.replaceState(null, '', '/admin#/collections/posts?f=author:120');
    const { find } = renderList();
    await waitFor(() => expect(find).toHaveBeenCalledWith('authors', '120', { depth: 0 }));
    await waitFor(() =>
      expect((screen.getByRole('combobox', { name: 'Author' }) as HTMLInputElement).value).toBe(
        'Author 120',
      ),
    );
  });
});
