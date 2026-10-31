import {
  type AdminDocument,
  type AdminSchema,
  flattenFields,
  useCms,
  useMessages,
} from '@adonis-agora/cms-react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Route } from './hash-route.js';

type Result = { key: string; label: string; hint: string; route: Route };

/** Ctrl/Cmd+K: find any document or collection by name, without going through the list first. */
export function CommandPalette({
  schema,
  onNavigate,
}: {
  schema: AdminSchema;
  onNavigate: (route: Route) => void;
}) {
  const t = useMessages();
  const { client } = useCms();
  const dialog = useRef<HTMLDialogElement>(null);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setTerm('');
        setSearch('');
        setActive(0);
        dialog.current?.showModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(term.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [term]);

  const searchable = useMemo(
    () =>
      schema.collections.flatMap((collection) => {
        const title = collection.admin?.useAsTitle;
        return title && flattenFields(collection.fields).some((field) => field.name === title)
          ? [{ collection, title }]
          : [];
      }),
    [schema],
  );

  const documents = useQuery({
    queryKey: ['cms', 'palette', search],
    enabled: search.length > 0,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const pages = await Promise.allSettled(
        searchable.map(({ collection, title }) =>
          client.list(collection.slug, {
            limit: 5,
            depth: 0,
            where: { [title]: { iContains: search } },
            ...(collection.drafts && schema.user ? { draft: true } : {}),
          }),
        ),
      );
      return pages.flatMap((page, index) => {
        const entry = searchable[index];
        if (page.status !== 'fulfilled' || !entry) return [];
        return page.value.docs.map((doc: AdminDocument) => ({
          key: `${entry.collection.slug}/${String(doc.id)}`,
          label: String(doc[entry.title] ?? doc.id),
          hint: entry.collection.labels?.singular ?? entry.collection.slug,
          route: { view: 'edit', slug: entry.collection.slug, id: String(doc.id) } as Route,
        }));
      });
    },
  });

  const needle = term.trim().toLowerCase();
  const sections: Result[] = [
    ...schema.collections.map((item) => ({
      key: `c/${item.slug}`,
      label: item.labels?.plural ?? item.slug,
      hint: t.content,
      route: { view: 'list', slug: item.slug } as Route,
    })),
    ...schema.globals.map((item) => ({
      key: `g/${item.slug}`,
      label: item.labels?.singular ?? item.slug,
      hint: t.globals,
      route: { view: 'global', slug: item.slug } as Route,
    })),
  ].filter((item) => item.label.toLowerCase().includes(needle));
  const results = [...sections, ...(search ? (documents.data ?? []) : [])];

  const choose = (result: Result | undefined) => {
    if (!result) return;
    dialog.current?.close();
    onNavigate(result.route);
  };

  return (
    <dialog ref={dialog} className="palette-dialog" aria-label={t.jumpTo}>
      <div className="palette-dialog__input">
        <Search aria-hidden />
        <input
          type="text"
          aria-label={t.jumpTo}
          placeholder={t.jumpTo}
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((value) => Math.min(value + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((value) => Math.max(value - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(results[active]);
            }
          }}
        />
      </div>
      <div className="palette-dialog__list">
        {results.length === 0 ? <p className="hint">{t.nothingFound}</p> : null}
        {results.map((result, index) => (
          <button
            key={result.key}
            type="button"
            className={`palette-dialog__item${index === active ? ' palette-dialog__item--active' : ''}`}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(result)}
          >
            <span>{result.label}</span>
            <small>{result.hint}</small>
          </button>
        ))}
      </div>
    </dialog>
  );
}
