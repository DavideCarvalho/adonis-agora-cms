import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../atoms/index.js';
import { useMessages } from '../context.js';
import {
  PREVIEW_BLOCK_MENU_MESSAGE,
  PREVIEW_BRIDGE_SOURCE,
  PREVIEW_DELETE_BLOCK_MESSAGE,
  PREVIEW_EDIT_BLOCK_MESSAGE,
  PREVIEW_EDIT_MESSAGE,
  PREVIEW_INSERT_BLOCK_MESSAGE,
  PREVIEW_INSERT_HERE_MESSAGE,
  PREVIEW_MOVE_BLOCK_MESSAGE,
} from '../preview.js';

export type LivePreviewProps = {
  url: string;
  data: unknown;
  open: boolean;
  onClose: () => void;
  /** Called when the page reports a click on a `data-cms-field` region. */
  onFocusField?: ((field: string) => void) | undefined;
  /** Called when the block toolbar asks to edit a block (`layout[2]`). */
  onEditBlock?: ((path: string) => void) | undefined;
  /** Called when a block is dragged to another position in the page. */
  onMoveBlock?: ((field: string, from: number, to: number) => void) | undefined;
  /** Called when the block toolbar deletes a block. */
  onDeleteBlock?: ((field: string, index: number) => void) | undefined;
  /** Called when a block is dropped from the palette into the page. */
  onInsertBlock?: ((field: string, type: string, index: number) => void) | undefined;
  /** Block slugs offered by the "+" menu inside the page. */
  blockTypes?: readonly string[] | undefined;
  /** Right-click → Duplicar. */
  onDuplicateBlock?: ((field: string, index: number) => void) | undefined;
  /** `inline` drops the fixed panel chrome so the editor can place it in its own grid. */
  variant?: 'panel' | 'inline';
  /** Bump to reload the frame (a newly inserted block does not exist in the current DOM). */
  refreshKey?: number;
};

/**
 * Iframe preview. The site listens for `{ type: 'cms:preview', data }` to re-render as you type,
 * and marks its editable regions with `data-cms-field`; clicking one brings the matching field
 * into view in the form. Same-origin frames get the bridge injected automatically; a site on
 * another origin calls `previewBridge()` from `@adonis-agora/cms-react/preview` itself.
 */
export function LivePreview({
  url,
  data,
  open,
  onClose,
  onFocusField,
  onEditBlock,
  onMoveBlock,
  onDeleteBlock,
  onInsertBlock,
  blockTypes = [],
  onDuplicateBlock,
  variant = 'panel',
  refreshKey = 0,
}: LivePreviewProps) {
  const t = useMessages();
  const frame = useRef<HTMLIFrameElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<
    | { kind: 'insert'; field: string; index: number; x: number; y: number }
    | { kind: 'block'; field: string; index: number; x: number; y: number }
    | null
  >(null);

  useEffect(() => {
    if (!open) return;
    const target = frame.current?.contentWindow;
    if (!target) return;
    const origin = new URL(url, window.location.origin).origin;
    target.postMessage({ type: 'cms:preview', data }, origin);
  }, [data, open, url]);

  useEffect(() => {
    if (!open) return;

    const onMessage = (event: MessageEvent) => {
      const payload = event.data as {
        type?: string;
        field?: unknown;
        blockType?: unknown;
        index?: unknown;
        x?: unknown;
        y?: unknown;
        from?: unknown;
        to?: unknown;
        path?: unknown;
      } | null;
      if (!payload || typeof payload.type !== 'string') return;

      const field = typeof payload.field === 'string' ? payload.field : null;

      if (payload.type === PREVIEW_EDIT_MESSAGE && field) {
        onFocusField?.(field);
        return;
      }
      if (payload.type === PREVIEW_EDIT_BLOCK_MESSAGE && typeof payload.path === 'string') {
        onEditBlock?.(payload.path);
        return;
      }
      if (payload.type === PREVIEW_DELETE_BLOCK_MESSAGE && field) {
        onDeleteBlock?.(field, Number(payload.index));
        return;
      }
      if (payload.type === PREVIEW_MOVE_BLOCK_MESSAGE && field) {
        onMoveBlock?.(field, Number(payload.from), Number(payload.to));
        return;
      }
      if (payload.type === PREVIEW_INSERT_BLOCK_MESSAGE && field) {
        const type = typeof payload.blockType === 'string' ? payload.blockType : '';
        if (type) onInsertBlock?.(field, type, Number(payload.index));
        return;
      }
      if (
        (payload.type === PREVIEW_INSERT_HERE_MESSAGE ||
          payload.type === PREVIEW_BLOCK_MENU_MESSAGE) &&
        field
      ) {
        // The frame reports coordinates in its own viewport; the menu lives in the admin's.
        const frameRect = frame.current?.getBoundingClientRect();
        const hostRect = body.current?.getBoundingClientRect();
        setMenu({
          kind: payload.type === PREVIEW_INSERT_HERE_MESSAGE ? 'insert' : 'block',
          field,
          index: Number(payload.index),
          x: (frameRect?.left ?? 0) - (hostRect?.left ?? 0) + Number(payload.x ?? 0),
          y: (frameRect?.top ?? 0) - (hostRect?.top ?? 0) + Number(payload.y ?? 0),
        });
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [open, onFocusField, onEditBlock, onMoveBlock, onDeleteBlock, onInsertBlock]);

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
    <aside
      className={`panel panel--preview${variant === 'inline' ? ' panel--inline' : ''}`}
      role={variant === 'inline' ? undefined : 'dialog'}
      aria-label={t.preview}
    >
      {variant === 'panel' ? (
        <header className="panel__head">
          <h2>{t.preview}</h2>
          <Button size="sm" tone="ghost" onClick={onClose}>
            {t.close}
          </Button>
        </header>
      ) : null}
      <div className="panel__body" ref={body}>
        {menu ? (
          <div
            className="preview-menu"
            style={{ left: Math.max(8, menu.x), top: Math.max(8, menu.y) }}
            role="menu"
          >
            {menu.kind === 'insert' ? (
              blockTypes.length === 0 ? (
                <span className="preview-menu__empty">no blocks</span>
              ) : (
                blockTypes.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      onInsertBlock?.(menu.field, type, menu.index);
                      setMenu(null);
                    }}
                  >
                    {type}
                  </button>
                ))
              )
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onEditBlock?.(`${menu.field}[${menu.index}]`);
                    setMenu(null);
                  }}
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDuplicateBlock?.(menu.field, menu.index);
                    setMenu(null);
                  }}
                >
                  Duplicar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onMoveBlock?.(menu.field, menu.index, menu.index - 1);
                    setMenu(null);
                  }}
                >
                  Mover ↑
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onMoveBlock?.(menu.field, menu.index, menu.index + 1);
                    setMenu(null);
                  }}
                >
                  Mover ↓
                </button>
                <button
                  type="button"
                  className="preview-menu__danger"
                  onClick={() => {
                    onDeleteBlock?.(menu.field, menu.index);
                    setMenu(null);
                  }}
                >
                  Excluir
                </button>
              </>
            )}
          </div>
        ) : null}
        <iframe
          ref={frame}
          src={refreshKey > 0 ? `${url}${url.includes('?') ? '&' : '?'}_r=${refreshKey}` : url}
          title={t.preview}
          onLoad={injectBridge}
        />
      </div>
    </aside>
  );
}
