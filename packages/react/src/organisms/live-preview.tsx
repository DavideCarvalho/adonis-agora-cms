import { useCallback, useEffect, useRef } from 'react';
import { Button } from '../atoms/index.js';
import { useMessages } from '../context.js';
import { PREVIEW_BRIDGE_SOURCE, PREVIEW_EDIT_MESSAGE } from '../preview.js';

export type LivePreviewProps = {
  url: string;
  data: unknown;
  open: boolean;
  onClose: () => void;
  /** Called when the page reports a click on a `data-cms-field` region. */
  onFocusField?: ((field: string) => void) | undefined;
};

/**
 * Iframe preview. The site listens for `{ type: 'cms:preview', data }` to re-render as you type,
 * and marks its editable regions with `data-cms-field`; clicking one brings the matching field
 * into view in the form. Same-origin frames get the bridge injected automatically; a site on
 * another origin calls `previewBridge()` from `@adonis-agora/cms-react/preview` itself.
 */
export function LivePreview({ url, data, open, onClose, onFocusField }: LivePreviewProps) {
  const t = useMessages();
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!open) return;
    const target = frame.current?.contentWindow;
    if (!target) return;
    const origin = new URL(url, window.location.origin).origin;
    target.postMessage({ type: 'cms:preview', data }, origin);
  }, [data, open, url]);

  useEffect(() => {
    if (!open || !onFocusField) return;

    const onMessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string; field?: unknown } | null;
      if (payload?.type !== PREVIEW_EDIT_MESSAGE) return;
      if (typeof payload.field !== 'string' || !payload.field) return;
      onFocusField(payload.field);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open, onFocusField]);

  const injectBridge = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;

    try {
      const script = doc.createElement('script');
      script.textContent = PREVIEW_BRIDGE_SOURCE;
      doc.head.append(script);
    } catch {
      // Cross-origin preview: the site installs the bridge itself.
    }
  }, []);

  if (!open) return null;

  return (
    <aside className="panel panel--preview" role="dialog" aria-label={t.preview}>
      <header className="panel__head">
        <h2>{t.preview}</h2>
        <Button size="sm" tone="ghost" onClick={onClose}>
          {t.close}
        </Button>
      </header>
      <div className="panel__body">
        <iframe ref={frame} src={url} title={t.preview} onLoad={injectBridge} />
      </div>
    </aside>
  );
}
