import { useQuery } from '@tanstack/react-query';
import { FileText, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '../atoms/index.js';
import { useCms, useMessages } from '../context.js';
import { useAdminSchema } from '../queries.js';
import type { AdminDocument } from '../types.js';

/** Grid of what is already in the media collection: pick by looking, not by reading ids. */
export function MediaLibrary({
  collection,
  onPick,
  onClose,
}: {
  collection: string;
  onPick: (doc: AdminDocument) => void;
  onClose: () => void;
}) {
  const t = useMessages();
  const { client } = useCms();
  const schema = useAdminSchema();
  const dialog = useRef<HTMLDialogElement>(null);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const titleField = schema.data?.collections.find((item) => item.slug === collection)?.admin
    ?.useAsTitle;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(term), 250);
    return () => window.clearTimeout(timer);
  }, [term]);

  const query = useQuery({
    queryKey: ['cms', 'media-library', collection, search],
    placeholderData: (previous) => previous,
    queryFn: () =>
      client.list(collection, {
        limit: 60,
        depth: 0,
        ...(search && titleField ? { where: { [titleField]: { iContains: search } } } : {}),
      }),
  });
  const docs = query.data?.docs ?? [];

  return (
    <dialog
      ref={dialog}
      className="library"
      aria-label={t.mediaLibrary}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="library__head">
        <h2>{t.mediaLibrary}</h2>
        {titleField ? (
          <div className="search">
            <Search aria-hidden />
            <Input
              type="search"
              aria-label={t.search}
              placeholder={t.search}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>
        ) : null}
        <Button size="sm" tone="ghost" aria-label={t.close} title={t.close} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </header>

      {query.error ? <p className="error">{query.error.message}</p> : null}
      {docs.length === 0 && !query.isLoading ? <p className="hint">{t.noDocuments}</p> : null}

      <div className="library__grid">
        {docs.map((doc) => {
          const url = typeof doc.url === 'string' ? doc.url : undefined;
          const mime = typeof doc.mime === 'string' ? doc.mime : '';
          const name = titleField ? String(doc[titleField] ?? doc.id) : String(doc.id);
          return (
            <button
              key={String(doc.id)}
              type="button"
              className="library__item"
              onClick={() => onPick(doc)}
            >
              <span className="library__thumb">
                {url && mime.startsWith('image/') ? (
                  <img src={url} alt="" loading="lazy" />
                ) : (
                  <FileText aria-hidden />
                )}
              </span>
              <span className="library__name">{name}</span>
            </button>
          );
        })}
      </div>
    </dialog>
  );
}
