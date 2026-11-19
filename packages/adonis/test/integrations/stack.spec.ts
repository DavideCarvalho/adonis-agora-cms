import { describe, expect, test } from 'vitest';
import { defineConfig } from '../../src/config/define_config.js';
import { media, uploads } from '../../src/integrations/factories.js';
import { describeCmsDatabase, STACK_DESCRIPTOR } from '../../src/integrations/stack.js';

const described = (value: object) => (value as Record<symbol, unknown>)[STACK_DESCRIPTOR];

describe('stack descriptors', () => {
  test('the Drive factories name their disk, or the default one', () => {
    expect(described(media.drive({ disk: 's3' }))).toEqual([
      { tech: 'drive', label: 's3', purpose: 'media files' },
    ]);
    expect(described(uploads.drive())).toEqual([
      { tech: 'drive', label: 'default', purpose: 'uploads' },
    ]);
    expect(Object.prototype.propertyIsEnumerable.call(uploads.drive(), STACK_DESCRIPTOR)).toBe(
      false,
    );
  });

  test('the config is tagged with the default Lucid connection', () => {
    const config = defineConfig({ db: { schema: 'managed' } });
    describeCmsDatabase(config, {
      connection: 'main',
      connections: { main: { client: 'pg' } },
    });
    expect(described(config)).toEqual([
      { tech: 'postgres', connection: 'main', purpose: 'content' },
    ]);
    expect(Object.keys(config)).toEqual(['db']);
  });

  test('an unknown client still links the connection; no database config adds nothing', () => {
    const config = defineConfig({});
    describeCmsDatabase(config, { connection: 'other', connections: {} });
    expect(described(config)).toEqual([{ tech: 'sql', connection: 'other', purpose: 'content' }]);

    const bare = defineConfig({});
    describeCmsDatabase(bare, undefined);
    expect(described(bare)).toBeUndefined();
  });

  test('a frozen config is left alone', () => {
    const frozen = Object.freeze(defineConfig({}));
    expect(() =>
      describeCmsDatabase(frozen, { connection: 'main', connections: { main: { client: 'pg' } } }),
    ).not.toThrow();
    expect(described(frozen)).toBeUndefined();
  });
});
