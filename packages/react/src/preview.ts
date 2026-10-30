/**
 * Frontend half of the live-preview editing bridge.
 *
 * A page marks the regions the editor may change with `data-cms-field="<field name>"` (the field
 * name in the CMS document, e.g. `title` or `sections.0.heading`). The bridge outlines those
 * regions, and a click posts `{ type: 'cms:edit-field', field }` to the admin, which scrolls to the
 * field and focuses it. Outside the preview nothing is outlined, so the same markup ships to
 * production untouched.
 *
 * The admin injects `PREVIEW_BRIDGE_SOURCE` automatically when the preview iframe is same-origin
 * (local dev). A site on another origin imports `previewBridge` from
 * `@adonis-agora/cms-react/preview` and calls it on load.
 */
export const PREVIEW_FIELD_ATTRIBUTE = 'data-cms-field';
export const PREVIEW_EDIT_MESSAGE = 'cms:edit-field';

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
}`;

/**
 * The bridge as a string, for the admin to inject into a same-origin preview iframe. Kept in sync
 * with `previewBridge()` by construction: both read the attribute, message and style from above.
 */
export const PREVIEW_BRIDGE_SOURCE = `(function () {
  var ATTR = ${JSON.stringify(PREVIEW_FIELD_ATTRIBUTE)};
  var MESSAGE = ${JSON.stringify(PREVIEW_EDIT_MESSAGE)};

  if (document.querySelector('style[data-cms-preview-bridge]')) return;

  var style = document.createElement('style');
  style.setAttribute('data-cms-preview-bridge', '');
  style.textContent = ${JSON.stringify(STYLE)};
  document.head.appendChild(style);

  document.addEventListener('click', function (event) {
    var region = event.target && event.target.closest
      ? event.target.closest('[' + ATTR + ']')
      : null;
    if (!region) return;

    // In preview a click edits; it must not navigate away from the page being previewed.
    event.preventDefault();
    event.stopPropagation();

    window.parent.postMessage(
      { type: MESSAGE, field: region.getAttribute(ATTR) },
      '*',
    );
  }, true);
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

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element | null;
    const region = target?.closest?.(`[${PREVIEW_FIELD_ATTRIBUTE}]`);
    if (!region) return;

    event.preventDefault();
    event.stopPropagation();

    window.parent?.postMessage(
      { type: PREVIEW_EDIT_MESSAGE, field: region.getAttribute(PREVIEW_FIELD_ATTRIBUTE) },
      '*',
    );
  };

  document.addEventListener('click', onClick, true);

  return () => {
    installed = false;
    document.removeEventListener('click', onClick, true);
    style.remove();
  };
}
