import { describe, expect, test } from 'vitest';
import { collection, defineConfig, fields } from '../../src/index.js';
import { compileSchema } from '../../src/schema/compile.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';
import {
  ensureVersionPartitions,
  versionPartitionDdl,
  versionPartitionDropDdl,
  versionPartitionPlan,
} from '../../src/versions/partitions.js';

const config = defineConfig({
  collections: [collection('posts', { fields: [fields.text('title')] })],
});
const spec = compileSchema(config, { engine: 'pg' });

describe('version partition plan', () => {
  test('creates one partition per month starting at the given month', () => {
    expect(
      versionPartitionPlan({ from: new Date('2026-10-15T00:00:00Z'), monthsAhead: 3 }),
    ).toEqual([
      { name: '2026_10', from: '2026-10-01', to: '2026-11-01' },
      { name: '2026_11', from: '2026-11-01', to: '2026-12-01' },
      { name: '2026_12', from: '2026-12-01', to: '2027-01-01' },
    ]);
  });

  test('emits PARTITION OF DDL with bounded ranges', () => {
    expect(
      versionPartitionDdl(spec, { from: new Date('2026-10-01T00:00:00Z'), monthsAhead: 1 }),
    ).toEqual([
      'CREATE TABLE IF NOT EXISTS "cms_versions_2026_10" PARTITION OF "cms_versions" FOR VALUES FROM (\'2026-10-01\') TO (\'2026-11-01\')',
    ]);
  });

  test('drops partitions older than the retention window', () => {
    const ddl = versionPartitionDropDdl(spec, {
      from: new Date('2026-10-01T00:00:00Z'),
      retentionMonths: 2,
    });
    expect(ddl).toHaveLength(2);
    expect(ddl[0]).toContain('cms_versions_2026_09');
    expect(ddl[1]).toContain('cms_versions_2026_08');
  });
});

describe('ensureVersionPartitions', () => {
  test('is a no-op outside Postgres', async () => {
    let kit: TestCms | undefined;
    try {
      kit = await createTestCms({ config });
      expect(await ensureVersionPartitions(kit.client, kit.spec)).toEqual({
        applied: 0,
        skipped: true,
      });
    } finally {
      await kit?.destroy();
    }
  });
});
