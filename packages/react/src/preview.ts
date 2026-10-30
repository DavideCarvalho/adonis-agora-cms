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
export const PREVIEW_FIELD_ATTRIBUTE = 'data-cms-field';
export const PREVIEW_BLOCK_ATTRIBUTE = 'data-cms-block';
export const PREVIEW_EDIT_MESSAGE = 'cms:edit-field';
export const PREVIEW_EDIT_BLOCK_MESSAGE = 'cms:edit-block';
export const PREVIEW_DELETE_BLOCK_MESSAGE = 'cms:delete-block';
export const PREVIEW_MOVE_BLOCK_MESSAGE = 'cms:move-block';

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
  position: absolute;
  top: 6px;
  right: 6px;
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
[${PREVIEW_BLOCK_ATTRIBUTE}]:hover > .cms-block-bar {
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

  if (document.querySelector('style[data-cms-preview-bridge]')) return;

  var style = document.createElement('style');
  style.setAttribute('data-cms-preview-bridge', '');
  style.textContent = ${JSON.stringify(STYLE)};
  document.head.appendChild(style);

  function post(type, payload) {
    payload.type = type;
    window.parent.postMessage(payload, '*');
  }

  /** "layout[2]" -> { field: "layout", index: 2 } */
  function parse(node) {
    var raw = node.getAttribute(BLOCK) || '';
    var match = /^(.*)\\[(\\d+)\\]$/.exec(raw);
    return match ? { field: match[1], index: Number(match[2]), path: raw } : null;
  }

  function blocksOf(field) {
    return Array.prototype.slice.call(
      document.querySelectorAll('[' + BLOCK + ']'),
    ).filter(function (node) {
      var ref = parse(node);
      return ref && ref.field === field;
    });
  }

  /** Keeps block and field paths in DOM order after a delete or a drag. */
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

  var drag = null;

  document.addEventListener('pointerdown', function (event) {
    var handle = event.target && event.target.closest
      ? event.target.closest('.cms-block-bar button[data-act="drag"]')
      : null;
    if (!handle) return;

    var node = handle.closest('[' + BLOCK + ']');
    var ref = node ? parse(node) : null;
    if (!node || !ref) return;

    event.preventDefault();
    drag = { node: node, ref: ref, target: null };
    node.setAttribute('data-cms-dragging', '1');
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

    node.removeAttribute('data-cms-dragging');
    blocksOf(ref.field).forEach(function (item) {
      item.removeAttribute('data-cms-drop');
    });

    var dropped = drag;
    drag = null;

    if (!target || target === node) return;

    var to = parse(target);
    if (!to) return;

    // Move the node in place so the preview matches immediately; the admin updates the form and
    // the next save/reload renders the same order from the server.
    var forward = to.index > ref.index;
    target.parentNode.insertBefore(node, forward ? target.nextSibling : target);
    renumber(ref.field);
    post(MOVE_BLOCK, { field: ref.field, from: ref.index, to: to.index });
    void dropped;
  });

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;

    var action = target.closest('.cms-block-bar button');
    if (action) {
      event.preventDefault();
      event.stopPropagation();

      var node = action.closest('[' + BLOCK + ']');
      var ref = node ? parse(node) : null;
      if (!ref) return;

      var act = action.getAttribute('data-act');
      if (act === 'delete') {
        node.remove();
        renumber(ref.field);
        post(DELETE_BLOCK, { field: ref.field, index: ref.index });
        return;
      }
      if (act === 'edit') {
        post(EDIT_BLOCK, { field: ref.field, index: ref.index, path: ref.path });
        return;
      }
      return;
    }

    var region = target.closest('[' + FIELD + ']');
    if (!region) return;

    // In preview a click edits; it must not navigate away from the page being previewed.
    event.preventDefault();
    event.stopPropagation();
    post(EDIT, { field: region.getAttribute(FIELD) });
  }, true);

  var decorate = function () {
    document.querySelectorAll('[' + BLOCK + ']').forEach(function (node) {
      if (node.querySelector(':scope > .cms-block-bar')) return;

      var bar = document.createElement('div');
      bar.className = 'cms-block-bar';
      bar.innerHTML =
        '<button type="button" data-act="drag" title="Drag to reorder">⠿</button>' +
        '<button type="button" data-act="edit" title="Edit block">✎</button>' +
        '<button type="button" data-act="delete" title="Delete block">🗑</button>';
      node.appendChild(bar);
    });
  };

  decorate();

  // The site can re-render its own DOM when it receives new data; keep decorating new blocks.
  if (window.MutationObserver) {
    new MutationObserver(decorate).observe(document.body, { childList: true, subtree: true });
  }
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

/** Parses `layout[2]` into the array field and the row index. */
export function parseBlockPath(path: string): { field: string; index: number } | null {
  const match = /^(.*)\[(\d+)\]$/.exec(path);
  if (!match) return null;
  return { field: match[1] as string, index: Number(match[2]) };
}
