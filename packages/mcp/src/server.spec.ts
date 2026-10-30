import { collection, createCms, defineConfig, fields } from '@adonis-agora/cms';
import { createTestCms, type TestCms } from '@adonis-agora/cms/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, test } from 'vitest';
import { createCmsMcpServer } from './server.js';

const config = defineConfig({
  db: { id: 'uuid', tablePrefix: 'cms_' },
  versions: { drafts: true },
  collections: [
    collection('posts', {
      fields: [
        fields.text('title', { required: true }),
        fields.slug('slug', { from: 'title', unique: true }),
        fields.select('status', {
          defaultValue: 'draft',
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        }),
      ],
    }),
  ],
});

let kit: TestCms | undefined;

afterEach(async () => {
  await kit?.destroy();
  kit = undefined;
});

async function connect(options: { allowWrite?: boolean } = {}) {
  kit = await createTestCms({ config });
  const cms = createCms({ config, client: kit.client, user: { id: 'agent' } });
  const server = createCmsMcpServer({ cms, ...options });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'cms-test', version: '1.0.0' });
  await client.connect(clientTransport);

  return { client, cms };
}

const text = (result: Awaited<ReturnType<Client['callTool']>>): string => {
  const content = result.content as { type: string; text?: string }[];
  return content.map((item) => item.text ?? '').join('');
};

describe('cms MCP server', () => {
  test('lists the content tools, with write annotations', async () => {
    const { client } = await connect();

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'cms_schema',
        'cms_list',
        'cms_get',
        'cms_create',
        'cms_update',
        'cms_delete',
        'cms_publish',
        'cms_versions',
        'cms_restore_version',
      ]),
    );

    const create = tools.find((tool) => tool.name === 'cms_create');
    expect(create?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((tool) => tool.name === 'cms_list')?.annotations?.readOnlyHint).toBe(true);
  });

  test('describes the schema so a model knows the fields', async () => {
    const { client } = await connect();

    const schema = JSON.parse(
      text(await client.callTool({ name: 'cms_schema', arguments: {} })),
    ) as { collections: { slug: string; fields: { name: string; type: string }[] }[] };

    expect(schema.collections[0]?.slug).toBe('posts');
    expect(schema.collections[0]?.fields.map((field) => field.name)).toEqual([
      'title',
      'slug',
      'status',
    ]);
  });

  test('creates, reads, publishes and lists a document', async () => {
    const { client } = await connect();

    const created = JSON.parse(
      text(
        await client.callTool({
          name: 'cms_create',
          arguments: { collection: 'posts', data: { title: 'Written by an agent' }, draft: true },
        }),
      ),
    ) as { id: string; slug: string; _status: string };

    expect(created.slug).toBe('written-by-an-agent');
    expect(created._status).toBe('draft');

    const listed = JSON.parse(
      text(
        await client.callTool({
          name: 'cms_list',
          arguments: { collection: 'posts', draft: true },
        }),
      ),
    ) as { totalDocs: number };

    expect(listed.totalDocs).toBe(1);

    const published = JSON.parse(
      text(
        await client.callTool({
          name: 'cms_publish',
          arguments: { collection: 'posts', id: created.id },
        }),
      ),
    ) as { _status: string };

    expect(published._status).toBe('published');

    const fetched = JSON.parse(
      text(
        await client.callTool({
          name: 'cms_get',
          arguments: { collection: 'posts', where: { slug: 'written-by-an-agent' } },
        }),
      ),
    ) as { title: string };

    expect(fetched.title).toBe('Written by an agent');

    const versions = JSON.parse(
      text(
        await client.callTool({
          name: 'cms_versions',
          arguments: { collection: 'posts', id: created.id },
        }),
      ),
    ) as { totalDocs: number };

    expect(versions.totalDocs).toBeGreaterThan(0);
  });

  test('a read-only session refuses writes but still reads', async () => {
    const { client } = await connect({ allowWrite: false });

    const refused = await client.callTool({
      name: 'cms_create',
      arguments: { collection: 'posts', data: { title: 'nope' } },
    });

    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('read-only');

    const listed = await client.callTool({ name: 'cms_list', arguments: { collection: 'posts' } });
    expect(listed.isError).toBeFalsy();
  });

  test('validation errors come back as tool errors, not crashes', async () => {
    const { client } = await connect();

    const result = await client.callTool({
      name: 'cms_create',
      arguments: { collection: 'posts', data: {} },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('title');
  });
});
