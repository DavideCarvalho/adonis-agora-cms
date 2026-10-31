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
/** Admin -> page: outline this block and bring it into view. */
export const PREVIEW_SELECT_BLOCK_MESSAGE = 'cms:select-block';
/** Ctrl/Cmd+S pressed while the focus is inside the page. */
export const PREVIEW_SAVE_MESSAGE = 'cms:save';
/** Set on <html> by `useLivePreviewData`: the page re-renders itself, so the bridge leaves its DOM alone. */
export const PREVIEW_LIVE_ATTRIBUTE = 'data-cms-live';

const STYLE = `
/* Quiet until asked: the page reads as the page, and only the block under the pointer shows chrome. */
[${PREVIEW_FIELD_ATTRIBUTE}] {
  cursor: pointer;
  transition: background 120ms ease, outline-color 120ms ease;
}
[${PREVIEW_FIELD_ATTRIBUTE}]:hover {
  outline: 1px solid #a855f7;
  outline-offset: 2px;
  background: rgba(168, 85, 247, 0.08);
}

[${PREVIEW_BLOCK_ATTRIBUTE}] {
  position: relative;
  border-radius: 6px;
}
[${PREVIEW_BLOCK_ATTRIBUTE}]:hover {
  outline: 1px solid rgba(168, 85, 247, 0.5);
  outline-offset: 3px;
}
[${PREVIEW_BLOCK_ATTRIBUTE}][data-cms-selected="1"] {
  outline: 2px solid #a855f7;
  outline-offset: 3px;
}
[${PREVIEW_BLOCK_ATTRIBUTE}][data-cms-drop="1"] {
  outline: 2px solid #a855f7;
  outline-offset: 3px;
  background: rgba(168, 85, 247, 0.06);
}
/* A dragged block lands on this side of its target. */
[${PREVIEW_BLOCK_ATTRIBUTE}][data-cms-drop="before"] {
  box-shadow: 0 -4px 0 #a855f7;
  border-radius: 0;
}
[${PREVIEW_BLOCK_ATTRIBUTE}][data-cms-drop="after"] {
  box-shadow: 0 4px 0 #a855f7;
  border-radius: 0;
}
[${PREVIEW_BLOCK_ATTRIBUTE}][data-cms-dragging="1"] {
  opacity: 0.45;
}

.cms-block-bar {
  position: fixed;
  /* Above the block, so it never covers the text being edited. */
  top: max(6px, calc(var(--cms-top) - 38px));
  left: var(--cms-left);
  z-index: 2147483000;
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: #18181b;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
  font: 500 12px/1 ui-sans-serif, system-ui, sans-serif;
}
[data-cms-overlay][data-visible] .cms-block-bar {
  opacity: 1;
  pointer-events: auto;
}
.cms-block-bar button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 26px;
  min-width: 26px;
  padding: 0 6px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #d4d4d8;
  font: inherit;
  cursor: pointer;
}
.cms-block-bar button:hover {
  background: #3f3f46;
  color: #fff;
}
.cms-block-bar button[data-act="delete"]:hover {
  background: #dc2626;
  color: #fff;
}
.cms-block-bar button[data-act="drag"] {
  cursor: grab;
  touch-action: none;
}
.cms-block-bar button[data-act="drag"]:active {
  cursor: grabbing;
}
.cms-block-bar svg {
  width: 14px;
  height: 14px;
  pointer-events: none;
}

.cms-block-add {
  position: fixed;
  left: calc(var(--cms-left) + var(--cms-width) / 2);
  top: calc(var(--cms-top) + var(--cms-height) - 12px);
  transform: translateX(-50%);
  z-index: 2147483000;
  display: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #9333ea;
  color: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  cursor: pointer;
}
.cms-block-add svg {
  width: 14px;
  height: 14px;
  pointer-events: none;
}
[data-cms-overlay][data-visible] .cms-block-add {
  display: grid;
  place-items: center;
}
.cms-block-add:hover {
  background: #7e22ce;
}

/* Full-height grip on the block's left edge: the easiest thing to grab, and it never covers text. */
.cms-block-grip {
  position: fixed;
  left: calc(var(--cms-left) - 9px);
  top: var(--cms-top);
  width: 6px;
  height: max(18px, var(--cms-height));
  z-index: 2147483000;
  border-radius: 3px;
  background: rgba(168, 85, 247, 0.55);
  opacity: 0;
  pointer-events: none;
  cursor: grab;
  touch-action: none;
  transition: opacity 120ms ease, background 120ms ease;
}
[data-cms-overlay][data-visible] .cms-block-grip {
  opacity: 1;
  pointer-events: auto;
}
.cms-block-grip:hover {
  background: #9333ea;
}
.cms-block-grip:active {
  cursor: grabbing;
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
  var SELECT_BLOCK = ${JSON.stringify(PREVIEW_SELECT_BLOCK_MESSAGE)};
  var SAVE = ${JSON.stringify(PREVIEW_SAVE_MESSAGE)};
  var LIVE = ${JSON.stringify(PREVIEW_LIVE_ATTRIBUTE)};

  // A component page owns its DOM: moving or removing its nodes here blanks it on the next render.
  // The attribute is the explicit signal; the rest catches pages with their own preview listener.
  function selfRendering(node) {
    if (document.documentElement.hasAttribute(LIVE)) return true;
    return Object.keys(node).some(function (key) {
      return key.indexOf('__react') === 0 || key.indexOf('__vue') === 0;
    });
  }

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
    '<button type="button" data-act="drag" title="Drag to reorder" aria-label="Move block"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg></button>' +
    '<button type="button" data-act="edit" title="Edit block" aria-label="Edit block"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>' +
    '<button type="button" data-act="delete" title="Delete block" aria-label="Delete block"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg></button>' +
    '</div>' +
    '<button type="button" class="cms-block-add" title="Insert a block below" aria-label="Insert a block below"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg></button>' +
    '<div class="cms-block-grip" title="Drag to move this block"></div>';
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

  // The toolbar is fixed to the viewport, so it has to follow the block while the page scrolls.
  function follow() {
    if (active && document.contains(active)) place(active);
    else if (active) place(null);
  }
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);

  window.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      post(SAVE, {});
    }
  });

  window.addEventListener('message', function (event) {
    var payload = event.data;
    if (!payload || payload.type !== SELECT_BLOCK) return;
    document.querySelectorAll('[' + BLOCK + '][data-cms-selected]').forEach(function (node) {
      node.removeAttribute('data-cms-selected');
    });
    if (!payload.path) return;
    var node = Array.prototype.slice
      .call(document.querySelectorAll('[' + BLOCK + ']'))
      .filter(function (item) {
        return item.getAttribute(BLOCK) === payload.path;
      })[0];
    if (!node) return;
    node.setAttribute('data-cms-selected', '1');
    var rect = node.getBoundingClientRect();
    if (rect.top < 0 || rect.top > window.innerHeight - 40) {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });

  overlay.addEventListener('pointerdown', function (event) {
    var handle =
      event.target && event.target.closest
        ? event.target.closest('button[data-act="drag"], .cms-block-grip')
        : null;
    if (!handle || !active) return;

    event.preventDefault();
    drag = { node: active, ref: parse(active), target: null };
    active.setAttribute('data-cms-dragging', '1');
    handle.setPointerCapture(event.pointerId);
  });

  document.addEventListener('pointermove', function (event) {
    if (!drag) return;

    // The nearest sibling, not the one under the pointer: gaps and neighbours must not lose the drop.
    var nearest = null;
    var distance = Infinity;
    blocksOf(drag.ref.field).forEach(function (node) {
      node.removeAttribute('data-cms-drop');
      var box = node.getBoundingClientRect();
      var away = Math.max(box.top - event.clientY, event.clientY - box.bottom, 0);
      if (away < distance) {
        distance = away;
        nearest = node;
      }
    });

    drag.target = nearest && nearest !== drag.node ? nearest : null;
    if (drag.target) {
      var after = parse(drag.target).index > drag.ref.index;
      drag.target.setAttribute('data-cms-drop', after ? 'after' : 'before');
    }
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

    if (!selfRendering(node)) {
      var forward = to.index > ref.index;
      target.parentNode.insertBefore(node, forward ? target.nextSibling : target);
      renumber(ref.field);
    }
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
      if (!selfRendering(active)) {
        active.remove();
        renumber(ref.field);
      }
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
        index: ref.index + 1,
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

    // The preview is a canvas: its links and buttons must not navigate the frame away.
    if (target.closest('a, button, [type="submit"]')) event.preventDefault();

    var region = target.closest('[' + FIELD + ']');
    if (!region) {
      var block = target.closest('[' + BLOCK + ']');
      var blockRef = block ? parse(block) : null;
      if (blockRef) post(EDIT_BLOCK, { field: blockRef.field, index: blockRef.index, path: blockRef.path });
      return;
    }

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
    // Upper half of a block inserts above it; outside any block appends.
    var index = blocksOf(payload.field).length;
    if (ref && ref.field === payload.field) {
      var box = candidate.getBoundingClientRect();
      index = event.clientY < box.top + box.height / 2 ? ref.index : ref.index + 1;
    }

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
    document.documentElement.setAttribute(PREVIEW_LIVE_ATTRIBUTE, '');

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
