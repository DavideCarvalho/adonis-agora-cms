import { describe, expect, test } from 'vitest';
import { renderMigration } from '../../src/commands/generate.js';
import { compileSchema } from '../../src/schema/compile.js';
import { blogConfig } from '../fixtures/blog_config.js';

const spec = compileSchema(blogConfig, { engine: 'sqlite' });

describe('cms:generate', () => {
  test('emits a timestamped migration with the serialized spec', () => {
    const { name, content } = renderMigration(spec, 1760000000000);

    expect(name).toBe('1760000000000_create_cms_tables.ts');
    expect(content).toContain(
      "import { detectEngine, dropCmsTables, syncCmsSchema } from '@adonis-agora/cms/db'",
    );
    expect(content).toContain('const spec: SchemaSpec = {');
    expect(content).toContain('"hash"');
    expect(content).toContain('await syncCmsSchema(client, spec');
    expect(content).toContain('export async function down');
  });

  test('does not import the user config, so old migrations stay reproducible', () => {
    const { content } = renderMigration(spec, 1760000000000);
    expect(content).not.toContain("from '#config/cms'");
    expect(content).not.toContain('config/cms.js');
  });

  test('embeds a spec that round-trips through JSON', () => {
    const { content } = renderMigration(spec, 1760000000000);
    const start = content.indexOf('const spec: SchemaSpec = ') + 'const spec: SchemaSpec = '.length;
    const end = content.indexOf('\n\nexport async function up');
    const embedded = JSON.parse(content.slice(start, end)) as { hash: string };
    expect(embedded.hash).toBe(spec.hash);
  });
});
