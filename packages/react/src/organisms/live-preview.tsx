import { useEffect, useRef } from 'react';
import { Button } from '../atoms/index.js';

export type LivePreviewProps = {
  /** Signed preview URL returned by the server (`/preview?token=…`). */
  url: string;
  /** Current form values; posted to the iframe on every change. */
  data: unknown;
  open: boolean;
  onClose: () => void;
};

/**
 * Live preview iframe.
 *
 * The site listens for `{ type: 'cms:preview', data }` and re-renders with the unsaved values.
 * The token in the URL is short-lived and signed, so the frame can read a draft without making
 * it public.
 */
export function LivePreview({ url, data, open, onClose }: LivePreviewProps) {
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
    <div className="fixed inset-y-0 right-0 z-40 flex w-[46rem] max-w-full flex-col border-l border-zinc-200 bg-white shadow-xl">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
        <span className="text-sm font-medium text-zinc-700">Preview</span>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </header>
      <iframe ref={frame} src={url} title="Preview" className="h-full w-full flex-1" />
    </div>
  );
}
