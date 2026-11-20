import type { AdminClient, AdminCollection } from '@adonis-agora/cms-react';
import { CmsProvider, ConfirmProvider, DataTable, EditForm } from '@adonis-agora/cms-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

const POSTS: AdminCollection = {
  slug: 'posts',
  kind: 'collection',
  versioned: false,
  drafts: false,
  admin: { useAsTitle: 'title' },
  fields: [{ name: 'title', type: 'text' }],
};

const CREATED = '2026-03-04T10:20:30.000Z';
const UPDATED = '2026-05-06T11:22:33.000Z';

function wrap(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CmsProvider client={{} as AdminClient}>
        <ConfirmProvider>{children}</ConfirmProvider>
      </CmsProvider>
    </QueryClientProvider>,
  );
}

const short = (iso: string) =>
  new Date(iso).toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' });

describe('document dates', () => {
  it('the edit form shows when the document was created and last updated', () => {
    wrap(
      <EditForm
        collection={POSTS}
        doc={{ id: '1', title: 'Hello', createdAt: CREATED, updatedAt: UPDATED }}
        onSubmit={() => true}
      />,
    );
    const dates = screen.getByTestId('document-dates');
    expect(dates.textContent).toContain(`Created ${short(CREATED)}`);
    expect(dates.textContent).toContain(`Updated ${short(UPDATED)}`);
    expect(screen.getByText(`Created ${short(CREATED)}`).getAttribute('title')).toBe(
      new Date(CREATED).toLocaleString('en'),
    );
  });

  it('a date the row does not have reads as a dash', () => {
    wrap(
      <EditForm
        collection={POSTS}
        doc={{ id: '1', title: 'Hello', createdAt: null, updatedAt: UPDATED }}
        onSubmit={() => true}
      />,
    );
    expect(screen.getByTestId('document-dates').textContent).toContain('Created —');
  });

  it('a new document has no dates yet', () => {
    wrap(<EditForm collection={POSTS} doc={{}} onSubmit={() => true} />);
    expect(screen.queryByTestId('document-dates')).toBeNull();
  });

  it('the list shows the full timestamp on hover of the updated date', () => {
    wrap(
      <DataTable
        collection={POSTS}
        docs={[{ id: '1', title: 'Hello', createdAt: CREATED, updatedAt: UPDATED }]}
        total={1}
        onOpen={() => {}}
      />,
    );
    const cell = screen.getByText(short(UPDATED));
    expect(cell.getAttribute('title')).toBe(new Date(UPDATED).toLocaleString('en'));
  });
});
