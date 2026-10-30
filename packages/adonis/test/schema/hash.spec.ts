import { describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { compileSchema } from '../../src/schema/compile.js';
import { canonicalJson, hashSchema } from '../../src/schema/hash.js';

function configWithFields(names: string[]) {
  return defineConfig({
    collections: [
      collection('posts', {
        fields: names.map((name) => fields.text(name)),
      }),
    ],
  });
}

function specWithoutHash(names: string[]) {
  const { hash: _hash, ...rest } = compileSchema(configWithFields(names), { engine: 'sqlite' });
  return rest;
}

describe('hashSchema', () => {
  test('ignores declaration order', () => {
    expect(hashSchema(specWithoutHash(['title', 'slug']))).toBe(
      hashSchema(specWithoutHash(['slug', 'title'])),
    );
  });

  test('changes when content changes', () => {
    expect(hashSchema(specWithoutHash(['title', 'slug']))).not.toBe(
      hashSchema(specWithoutHash(['title', 'body'])),
    );
  });

  test('changes when options change', () => {
    const a = compileSchema(
      defineConfig({
        collections: [collection('posts', { fields: [fields.text('title', { maxLength: 10 })] })],
      }),
      { engine: 'sqlite' },
    );
    const b = compileSchema(
      defineConfig({
        collections: [collection('posts', { fields: [fields.text('title', { maxLength: 20 })] })],
      }),
      { engine: 'sqlite' },
    );
    expect(a.hash).not.toBe(b.hash);
  });

  test('is stable across engines only when the physical schema is identical', () => {
    const sqlite = compileSchema(configWithFields(['title']), { engine: 'sqlite' });
    const postgres = compileSchema(configWithFields(['title']), { engine: 'pg' });
    expect(sqlite.hash).not.toBe(postgres.hash);
  });
});

describe('canonicalJson', () => {
  test('sorts object keys and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: undefined } })).toBe('{"a":{"d":2},"b":1}');
  });

  test('preserves array order', () => {
    expect(canonicalJson([2, 1, 3])).toBe('[2,1,3]');
  });
});
