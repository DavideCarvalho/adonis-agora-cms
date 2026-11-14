import { describe, expect, it } from 'vitest';
import { CONFIG_ELEMENT_ID, injectDataBlock } from './cms_admin_provider.js';

const read = (html: string) =>
  JSON.parse(new RegExp(`id="${CONFIG_ELEMENT_ID}">(.*?)</script>`).exec(html)?.[1] ?? 'null');

describe('injectDataBlock', () => {
  it('puts the shell fields in a JSON data block before </head>', () => {
    const fields = {
      switcher: { endpoint: '/api/cms/consoles', others: 2 },
      viewer: { label: 'Ann' },
    };
    const html = injectDataBlock('<html><head><title>x</title></head><body></body></html>', fields);
    expect(html).toContain(`<script type="application/json" id="cms-config">`);
    expect(html.indexOf('cms-config')).toBeLessThan(html.indexOf('</head>'));
    expect(read(html)).toEqual(fields);
  });

  it('escapes what could close the element, and keeps `$` patterns literal', () => {
    const fields = { viewer: { label: '</script><script>alert(1)</script> $& $1 &amp;' } };
    const html = injectDataBlock('<head></head>', fields);
    expect(html).not.toContain('</script><script>');
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(read(html)).toEqual(fields);
  });
});
