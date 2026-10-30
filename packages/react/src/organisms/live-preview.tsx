import { useEffect, useRef } from 'react';
import { Button } from '../atoms/index.js';
import { useMessages } from '../context.js';

export type LivePreviewProps = {
  url: string;
  data: unknown;
  open: boolean;
  onClose: () => void;
};

/** Iframe preview; the site listens for `{ type: 'cms:preview', data }`. */
export function LivePreview({ url, data, open, onClose }: LivePreviewProps) {
  const t = useMessages();
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open) return;
    const target = frame.current?.contentWindow;
    if (!target) return;
    const origin = new URL(url, window.location.origin).origin;
    target.postMessage({ type: 'cms:preview', data }, origin);
  }, [data, open, url]);

  if (!open) return null;

  return (
    <aside className="panel panel--preview" role="dialog" aria-label={t.preview}>
      <header className="panel__head">
        <h2>{t.preview}</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t.close}
        </Button>
      </header>
      <div className="panel__body">
        <iframe ref={frame} src={url} title={t.preview} />
      </div>
    </aside>
  );
}
