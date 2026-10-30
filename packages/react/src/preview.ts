import { useEffect, useState } from 'react';

/**
 * Frontend half of the live-preview editing bridge.
 *
 * A page marks its editable regions with `data-cms-field="<field name>"` and each block wrapper with
 * `data-cms-block="<array>[<index>]"`. The bridge outlines the regions, gives every block a toolbar
 * (drag / edit / delete) and reports clicks to the admin, which focuses the matching field or
 * applies the structural change to the form.
 *
 * The admin injects `PREVIEW_BRIDGE_SOURCE` automatically when the preview iframe is same-origin
 * (local dev). A site on another origin imports `previewBridge` from
 * `@adonis-agora/cms-react/preview` and calls it on load.
 */
/** The admin posts the whole document with this type on every edit. */
export const PREVIEW_PREVIEW_MESSAGE = 'cms:preview';
export const PREVIEW_FIELD_ATTRIBUTE = 'data-cms-field';
export const PREVIEW_BLOCK_ATTRIBUTE = 'data-cms-block';
export const PREVIEW_EDIT_MESSAGE = 'cms:edit-field';
export const PREVIEW_EDIT_BLOCK_MESSAGE = 'cms:edit-block';
export const PREVIEW_DELETE_BLOCK_MESSAGE = 'cms:delete-block';
export const PREVIEW_MOVE_BLOCK_MESSAGE = 'cms:move-block';
export const PREVIEW_INSERT_BLOCK_MESSAGE = 'cms:insert-block';
/** "+" in the page: ask the admin for a block type to insert at that position. */
export const PREVIEW_INSERT_HERE_MESSAGE = 'cms:insert-here';
/** Right-click on a block: open the block menu in the admin. */
export const PREVIEW_BLOCK_MENU_MESSAGE = 'cms:block-menu';
/** MIME used when a block is dragged from the palette into the page. */
export const PREVIEW_BLOCK_MIME = 'application/x-cms-block';

const STYLE = `
[${PREVIEW_FIELD_ATTRIBUTE}] {
  outline: 1px dashed rgba(192, 132, 252, 0.45);
  outline-offset: 2px;
  cursor: pointer;
  transition: background 120ms ease, outline-color 120ms ease;
}
[${PREVIEW_FIELD_ATTRIBUTE}]:hover {
  outline: 1px solid #c084fc;
  background: rgba(192, 132, 252, 0.08);
}

[${PREVIEW_BLOCK_ATTRIBUTE}] {
  position: relative;
  outline: 1px dashed rgba(96, 165, 250, 0.35);
  outline-offset: 4px;
  border-radius: 6px;
}
[${PREVIEW_BLOCK_ATTRIBUTE}]:hover {
  outline-color: rgba(192, 132, 252, 0.55);
}
[${PREVIEW_BLOCK_ATTRIBUTE}][data-cms-drop="1"] {
  outline: 2px solid #c084fc;
  background: rgba(192, 132, 252, 0.06);
}
[${PREVIEW_BLOCK_ATTRIBUTE}][data-cms-dragging="1"] {
  opacity: 0.45;
}

.cms-block-bar {
  position: fixed;
  top: calc(var(--cms-top) + 6px);
  left: calc(var(--cms-left) + var(--cms-width) - 90px);
  z-index: 2147483000;
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid #2a2a33;
  border-radius: 8px;
  background: #0c0c0f;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity 120ms ease, transform 120ms ease;
  font-family: ui-monospace, monospace;
}
[data-cms-overlay][data-visible] .cms-block-bar {
  opacity: 1;
  transform: none;
}
.cms-block-bar button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #a1a1aa;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.cms-block-bar button:hover {
  background: #1c1c22;
  color: #e7e7ea;
}
.cms-block-bar button[data-act="delete"]:hover {
  background: rgba(248, 113, 113, 0.16);
  color: #f87171;
}
.cms-block-bar button[data-act="drag"] {
  cursor: grab;
  touch-action: none;
}
.cms-block-bar button[data-act="drag"]:active {
  cursor: grabbing;
}

.cms-block-add {
  position: fixed;
  left: calc(var(--cms-left) + var(--cms-width) / 2 - 11px);
  top: calc(var(--cms-top) - 12px);
  transform: translateX(-50%);
  z-index: 2147483000;
  display: none;
  width: 22px;
  height: 22px;
  border: 1px solid #c084fc;
  border-radius: 50%;
  background: #0c0c0f;
  color: #c084fc;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
[data-cms-overlay][data-visible] .cms-block-add {
  display: grid;
  place-items: center;
}
.cms-block-add:hover {
  background: #c084fc;
  color: #180a26;
}`;

/**
 * The bridge as a string, for the admin to inject into a same-origin preview iframe. Kept in sync
 * with `previewBridge()` by construction: both read the attributes, messages and style from above.
 */
export const PREVIEW_BRIDGE_SOURCE = `(function () {
  var FIELD = ${JSON.stringify(PREVIEW_FIELD_ATTRIBUTE)};
  var BLOCK = ${JSON.stringify(PREVIEW_BLOCK_ATTRIBUTE)};
  var EDIT = ${JSON.stringify(PREVIEW_EDIT_MESSAGE)};
  var EDIT_BLOCK = ${JSON.stringify(PREVIEW_EDIT_BLOCK_MESSAGE)};
  var DELETE_BLOCK = ${JSON.stringify(PREVIEW_DELETE_BLOCK_MESSAGE)};
  var MOVE_BLOCK = ${JSON.stringify(PREVIEW_MOVE_BLOCK_MESSAGE)};
  var INSERT_BLOCK = ${JSON.stringify(PREVIEW_INSERT_BLOCK_MESSAGE)};
  var INSERT_HERE = ${JSON.stringify(PREVIEW_INSERT_HERE_MESSAGE)};
  var BLOCK_MENU = ${JSON.stringify(PREVIEW_BLOCK_MENU_MESSAGE)};
  var MIME = ${JSON.stringify(PREVIEW_BLOCK_MIME)};

  if (document.getElementById('cms-preview-overlay')) return;

  var style = document.createElement('style');
  style.setAttribute('data-cms-preview-bridge', '');
  style.textContent = ${JSON.stringify(STYLE)};
  document.head.appendChild(style);

  function post(type, payload) {
    payload.type = type;
    window.parent.postMessage(payload, '*');
  }

  /** "layout[2]" -> { field: "layout", index: 2, path: "layout[2]" } */
  function parse(node) {
    var raw = node.getAttribute(BLOCK) || '';
    var last = raw.lastIndexOf('[');
    if (last < 0) return null;
    var field = raw.slice(0, last);
    var index = Number(raw.slice(last + 1, -1));
    if (!field || !isFinite(index)) return null;
    return { field: field, index: index, path: raw };
  }

  function blocksOf(field) {
    return Array.prototype.slice
      .call(document.querySelectorAll('[' + BLOCK + ']'))
      .filter(function (node) {
        var ref = parse(node);
        return ref && ref.field === field;
      });
  }

  function renumber(field) {
    blocksOf(field).forEach(function (node, index) {
      var ref = parse(node);
      if (!ref) return;

      var nextPath = ref.field + '[' + index + ']';
      if (ref.path === nextPath) return;

      var previous = ref.path + '.';
      node.setAttribute(BLOCK, nextPath);
      node.querySelectorAll('[' + FIELD + ']').forEach(function (region) {
        var value = region.getAttribute(FIELD) || '';
        if (value.indexOf(previous) === 0) {
          region.setAttribute(FIELD, nextPath + '.' + value.slice(previous.length));
        }
      });
    });
  }

  // --- overlay: the toolbar lives outside the app's React tree -----------------------------
  // Injecting it inside the block made React drop the buttons on every preview re-render.
  var overlay = document.createElement('div');
  overlay.id = 'cms-preview-overlay';
  overlay.setAttribute('data-cms-overlay', '');
  overlay.innerHTML =
    '<div class="cms-block-bar">' +
    '<button type="button" data-act="drag" title="Drag to reorder">⠿</button>' +
    '<button type="button" data-act="edit" title="Edit block">✎</button>' +
    '<button type="button" data-act="delete" title="Delete block">🗑</button>' +
    '</div>' +
    '<button type="button" class="cms-block-add" title="Insert a block here">+</button>';
  document.body.appendChild(overlay);

  var active = null;
  var drag = null;

  function place(node) {
    var ref = node ? parse(node) : null;
    if (!node || !ref) {
      overlay.removeAttribute('data-visible');
      active = null;
      return;
    }

    active = node;
    var rect = node.getBoundingClientRect();
    overlay.style.setProperty('--cms-left', rect.left + 'px');
    overlay.style.setProperty('--cms-top', rect.top + 'px');
    overlay.style.setProperty('--cms-width', rect.width + 'px');
    overlay.style.setProperty('--cms-height', rect.height + 'px');
    overlay.setAttribute('data-visible', '');
  }

  document.addEventListener('mousemove', function (event) {
    if (drag) return;

    var target = event.target;
    if (target && target.closest && target.closest('#cms-preview-overlay')) return;

    var node = target && target.closest ? target.closest('[' + BLOCK + ']') : null;
    if (node) place(node);
  }, true);

  document.addEventListener('mouseleave', function () {
    if (!drag) overlay.removeAttribute('data-visible');
  });

  overlay.addEventListener('pointerdown', function (event) {
    var handle = event.target && event.target.closest ? event.target.closest('button[data-act="drag"]') : null;
    if (!handle || !active) return;

    event.preventDefault();
    drag = { node: active, ref: parse(active), target: null };
    active.setAttribute('data-cms-dragging', '1');
    handle.setPointerCapture(event.pointerId);
  });

  document.addEventListener('pointermove', function (event) {
    if (!drag) return;

    var under = document.elementFromPoint(event.clientX, event.clientY);
    var candidate = under && under.closest ? under.closest('[' + BLOCK + ']') : null;
    var ref = candidate ? parse(candidate) : null;

    blocksOf(drag.ref.field).forEach(function (node) {
      node.removeAttribute('data-cms-drop');
    });

    drag.target = candidate && ref && ref.field === drag.ref.field ? candidate : null;
    if (drag.target) drag.target.setAttribute('data-cms-drop', '1');
  });

  document.addEventListener('pointerup', function () {
    if (!drag) return;

    var node = drag.node;
    var ref = drag.ref;
    var target = drag.target;
    var to = target ? parse(target) : null;

    node.removeAttribute('data-cms-dragging');
    blocksOf(ref.field).forEach(function (item) {
      item.removeAttribute('data-cms-drop');
    });
    drag = null;

    if (!target || target === node || !to) return;

    var forward = to.index > ref.index;
    target.parentNode.insertBefore(node, forward ? target.nextSibling : target);
    renumber(ref.field);
    post(MOVE_BLOCK, { field: ref.field, from: ref.index, to: to.index });
  });

  overlay.addEventListener('click', function (event) {
    var button = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!button || !active) return;

    event.preventDefault();
    event.stopPropagation();

    var ref = parse(active);
    if (!ref) return;

    var act = button.getAttribute('data-act');
    if (act === 'delete') {
      active.remove();
      renumber(ref.field);
      post(DELETE_BLOCK, { field: ref.field, index: ref.index });
      overlay.removeAttribute('data-visible');
      active = null;
      return;
    }
    if (act === 'edit') {
      post(EDIT_BLOCK, { field: ref.field, index: ref.index, path: ref.path });
      return;
    }
    if (button.classList.contains('cms-block-add')) {
      var rect = button.getBoundingClientRect();
      post(INSERT_HERE, {
        field: ref.field,
        index: ref.index,
        x: rect.left,
        y: rect.bottom + 6,
      });
    }
  }, true);

  // Right-click a block: duplicate / move / delete, mirrored in the admin.
  document.addEventListener('contextmenu', function (event) {
    var node = event.target && event.target.closest ? event.target.closest('[' + BLOCK + ']') : null;
    var ref = node ? parse(node) : null;
    if (!ref) return;

    event.preventDefault();
    post(BLOCK_MENU, { field: ref.field, index: ref.index, x: event.clientX, y: event.clientY });
  }, true);

  // Clicking a field asks the admin to focus it (and select its block).
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    if (target.closest('#cms-preview-overlay')) return;

    var region = target.closest('[' + FIELD + ']');
    if (!region) return;

    event.preventDefault();
    event.stopPropagation();
    post(EDIT, { field: region.getAttribute(FIELD) });
  }, true);

  // Palette drop: a block dragged from the admin sidebar into the page.
  document.addEventListener('dragover', function (event) {
    if (!event.dataTransfer || event.dataTransfer.types.indexOf(MIME) === -1) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    var under = document.elementFromPoint(event.clientX, event.clientY);
    var candidate = under && under.closest ? under.closest('[' + BLOCK + ']') : null;
    document.querySelectorAll('[' + BLOCK + '][data-cms-drop]').forEach(function (node) {
      node.removeAttribute('data-cms-drop');
    });
    if (candidate) candidate.setAttribute('data-cms-drop', '1');
  });

  document.addEventListener('drop', function (event) {
    if (!event.dataTransfer || event.dataTransfer.types.indexOf(MIME) === -1) return;
    event.preventDefault();

    var payload = null;
    try {
      payload = JSON.parse(event.dataTransfer.getData(MIME) || 'null');
    } catch (error) {
      payload = null;
    }
    if (!payload || !payload.field || !payload.blockType) return;

    var under = document.elementFromPoint(event.clientX, event.clientY);
    var candidate = under && under.closest ? under.closest('[' + BLOCK + ']') : null;
    var ref = candidate ? parse(candidate) : null;
    var index = ref && ref.field === payload.field ? ref.index + 1 : 0;

    document.querySelectorAll('[' + BLOCK + '][data-cms-drop]').forEach(function (node) {
      node.removeAttribute('data-cms-drop');
    });
    post(INSERT_BLOCK, { field: payload.field, blockType: payload.blockType, index: index });
  });
})();`;

let installed = false;

/** Outlines `[data-cms-field]` regions and reports clicks to the parent window. Idempotent. */
export function previewBridge(): () => void {
  if (typeof document === 'undefined' || installed) return () => undefined;
  installed = true;

  const style = document.createElement('style');
  style.setAttribute('data-cms-preview-bridge', '');
  style.textContent = STYLE;
  document.head.appendChild(style);

  const post = (type: string, payload: Record<string, unknown>) =>
    window.parent?.postMessage({ type, ...payload }, '*');

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const region = target?.closest?.(`[${PREVIEW_FIELD_ATTRIBUTE}]`);
    if (!region) return;

    event.preventDefault();
    event.stopPropagation();
    post(PREVIEW_EDIT_MESSAGE, {
      field: region.getAttribute(PREVIEW_FIELD_ATTRIBUTE),
    });
  };

  document.addEventListener('click', onClick, true);

  return () => {
    installed = false;
    document.removeEventListener('click', onClick, true);
    style.remove();
  };
}

/**
 * Props for a JSX element bound to a field: `<h1 {...editable('layout[0]', 'heading')}>`.
 * Same attribute the string renderers write by hand.
 */
export function editable(path: string, field?: string): { 'data-cms-field': string } {
  return { 'data-cms-field': field ? `${path}.${field}` : path };
}

/** Props for the wrapper of a block: `<div {...editableBlock('layout', index)}>`. */
export function editableBlock(path: string, index: number): { 'data-cms-block': string } {
  return { 'data-cms-block': `${path}[${index}]` };
}

/**
 * React side of the live preview: the admin posts the whole document on every edit
 * (`{ type: 'cms:preview', data }`), so returning the latest data makes the page re-render as you
 * type, move, delete or insert — including changes made from the admin's own menus.
 *
 * ```tsx
 * const doc = useLivePreviewData(page);
 * ```
 */
export function useLivePreviewData<T>(initial: T): T {
  const [data, setData] = useState<T>(initial);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const payload = event.data as { type?: string; data?: unknown } | null;
      if (payload?.type !== PREVIEW_PREVIEW_MESSAGE) return;
      if (payload.data === undefined) return;
      setData(payload.data as T);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return data;
}

/** Parses `layout[2]` into the array field and the row index. */
export function parseBlockPath(path: string): { field: string; index: number } | null {
  const match = /^(.*)\[(\d+)\]$/.exec(path);
  if (!match) return null;
  return { field: match[1] as string, index: Number(match[2]) };
}
