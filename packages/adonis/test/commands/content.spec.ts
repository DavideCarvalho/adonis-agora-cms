import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IgnitorFactory } from '@adonisjs/core/factories';
import type { ApplicationService } from '@adonisjs/core/types';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  CmsCollectionsList,
  CmsCollectionsShow,
  CmsDocumentsCreate,
  CmsDocumentsDelete,
  CmsDocumentsDiscardDraft,
  CmsDocumentsList,
  CmsDocumentsPublish,
  CmsDocumentsRestore,
  CmsDocumentsSchedule,
  CmsDocumentsScheduled,
  CmsDocumentsShow,
  CmsDocumentsUnpublish,
  CmsDocumentsUnschedule,
  CmsDocumentsUpdate,
  CmsGlobalsShow,
  CmsGlobalsUpdate,
  CmsVersionsList,
  CmsVersionsRestore,
  CmsVersionsShow,
  contentCommands,
} from '../../src/commands/content.js';
import { getCommand, getMetaData } from '../../src/commands/main.js';
import { collection, createApiToken, defineConfig, fields } from '../../src/index.js';
import { type Cms, createCms } from '../../src/local_api/index.js';
import { createTestCms, type TestCms } from '../../src/testing/create_test_cms.js';

const config = defineConfig({
  db: { id: 'uuid' },
  versions: { drafts: true },
  collections: [
    collection('posts', {
      softDelete: true,
      fields: [fields.text('title', { required: true })],
    }),
    collection('locked', {
      access: { create: () => false, read: () => true },
      fields: [fields.text('title')],
    }),
  ],
  globals: [{ slug: 'site', fields: [fields.text('name')] }],
});

describe('cms content commands', () => {
  let kit: TestCms;
  let cms: Cms;
  let app: ApplicationService;
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cms-cli-'));
    kit = await createTestCms({ config });
    cms = createCms({ config, client: kit.client });
    app = new IgnitorFactory()
      .withCoreConfig()
      .withCoreProviders()
      .create(new URL('./tmp/', import.meta.url))
      .createApp('console') as ApplicationService;
    await app.init();
    await app.boot();
    (app.container as unknown as { singleton(n: string, f: () => unknown): void }).singleton(
      'cms',
      () => cms,
    );
    delete process.env.CMS_API_TOKEN;
  });

  afterEach(async () => {
    await app.terminate();
    await kit.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  type Ran = {
    exitCode?: number;
    ui: { logger: { getLogs(): Array<{ message: string }> } };
    assertSucceeded(): void;
    assertFailed(): void;
  };
  async function run(command: unknown, args: string[] = []): Promise<Ran> {
    const ace = await app.container.make('ace');
    const instance = (await ace.create(command as never, args)) as unknown as {
      ui: { switchMode(mode: 'raw'): void };
      exec(): Promise<unknown>;
    };
    instance.ui.switchMode('raw');
    await instance.exec();
    return instance as unknown as Ran;
  }
  const logs = (ran: Ran) =>
    ran.ui.logger
      .getLogs()
      .map((line) => line.message)
      .join('\n');
  async function json(command: unknown, args: string[] = []) {
    const ran = await run(command, [...args, '--json']);
    ran.assertSucceeded();
    return JSON.parse(logs(ran));
  }
  async function token(abilities: string[]) {
    return createApiToken(cms.repoContext(), { name: 'cli', abilities });
  }

  test('the barrel lists every content command with metadata matching its class', async () => {
    const meta = await getMetaData();
    for (const command of contentCommands) {
      const entry = meta.find((item) => item.commandName === command.commandName);
      expect(entry, command.commandName).toBeDefined();
      const {
        filePath: _f,
        exportName,
        ...listed
      } = entry as typeof entry & {
        exportName?: string;
      };
      expect(listed).toEqual(
        (command as unknown as { serialize(): Record<string, unknown> }).serialize(),
      );
      expect(await getCommand({ commandName: command.commandName })).toBe(command);
      expect(exportName).toBe(command.name);
      expect(command.commandName).toMatch(/^cms:[a-z]+:[a-z-]+$/);
    }
    expect(meta.map((item) => item.commandName)).toContain('cms:status');
  });

  test('reads the content model through the hub tools', async () => {
    const model = await json(CmsCollectionsList);
    expect(model.items.map((item: { slug: string }) => item.slug)).toEqual([
      'posts',
      'locked',
      'site',
    ]);
    const posts = await json(CmsCollectionsShow, ['posts']);
    expect(posts.fields[0]).toMatchObject({ name: 'title', type: 'text', required: true });
    const missing = await run(CmsCollectionsShow, ['nope']);
    missing.assertFailed();
    expect(logs(missing)).toContain('CMS_NOT_FOUND');
  });

  test('refuses a write without an actor, and with both a token and --as-system', async () => {
    const refused = await run(CmsDocumentsCreate, ['posts', '--data', '{"title":"Hi"}']);
    refused.assertFailed();
    expect(refused.exitCode).toBe(1);
    expect(logs(refused)).toContain('writes need an actor');

    const both = await run(CmsDocumentsCreate, [
      'posts',
      '--data',
      '{"title":"Hi"}',
      '--as-system',
      '--token',
      'x',
    ]);
    both.assertFailed();
    expect(logs(both)).toContain('not both');
    expect((await cms.collection('posts').find({})).totalDocs).toBe(0);
  });

  test('a token writes like a Bearer REST call: read-only tokens are refused', async () => {
    const readOnly = await token(['read']);
    const refused = await run(CmsDocumentsCreate, [
      'posts',
      '--data',
      '{"title":"Hi"}',
      '--token',
      readOnly,
    ]);
    refused.assertFailed();
    expect(logs(refused)).toContain('403 CMS_FORBIDDEN: token is read-only');

    process.env.CMS_API_TOKEN = await token(['read', 'write']);
    const created = await json(CmsDocumentsCreate, ['posts', '--data', '{"title":"Hi"}']);
    expect(created).toMatchObject({ title: 'Hi', _status: 'published' });

    const unknown = await run(CmsDocumentsList, ['posts', '--token', 'cms_nope']);
    unknown.assertFailed();
    expect(logs(unknown)).toContain('unknown or expired CMS API token');

    const tenant = await run(CmsDocumentsList, ['posts', '--tenant', 'acme']);
    tenant.assertFailed();
    expect(logs(tenant)).toContain('token cannot switch tenant');
  });

  test('--as-system writes, but access rules still decide', async () => {
    const created = await json(CmsDocumentsCreate, [
      'posts',
      '--data',
      '{"title":"Draft"}',
      '--draft',
      '--as-system',
    ]);
    expect(created._status).toBe('draft');

    const denied = await run(CmsDocumentsCreate, [
      'locked',
      '--data',
      '{"title":"x"}',
      '--as-system',
    ]);
    denied.assertFailed();
    expect(logs(denied)).toContain('create "locked" is not allowed');

    const invalid = await run(CmsDocumentsCreate, ['posts', '--data', '{}', '--as-system']);
    invalid.assertFailed();
    expect(logs(invalid)).toContain('422');
    expect(logs(invalid)).toContain('title');

    const badJson = await run(CmsDocumentsCreate, ['posts', '--data', '{nope', '--as-system']);
    badJson.assertFailed();
    expect(logs(badJson)).toContain('--data must be JSON');
  });

  test('lists in the REST envelope with filters, sort and paging; reads one; drafts stay hidden', async () => {
    for (const title of ['b', 'a', 'c']) {
      await cms.collection('posts').create({ title } as never);
    }
    await cms.collection('posts').create({ title: 'hidden' } as never, { draft: true });

    const page = await json(CmsDocumentsList, ['posts', '--sort', 'title', '--size', '2']);
    expect(page.data.map((doc: { title: string }) => doc.title)).toEqual(['a', 'b']);
    expect(page.meta).toMatchObject({ total: 3, perPage: 2, currentPage: 1, lastPage: 2 });

    const filtered = await json(CmsDocumentsList, ['posts', '--filter', '{"title":"c"}']);
    expect(filtered.data).toHaveLength(1);

    const file = join(dir, 'filter.json');
    writeFileSync(file, JSON.stringify({ title: { in: ['a', 'b'] } }));
    expect((await json(CmsDocumentsList, ['posts', '--filter', `@${file}`])).data).toHaveLength(2);

    const badSort = await run(CmsDocumentsList, ['posts', '--sort', 'nope']);
    badSort.assertFailed();
    expect(logs(badSort)).toContain('400');

    const one = await json(CmsDocumentsShow, ['posts', filtered.data[0].id]);
    expect(one.title).toBe('c');
    const missing = await run(CmsDocumentsShow, ['posts', '00000000-0000-0000-0000-000000000000']);
    missing.assertFailed();
    expect(logs(missing)).toContain('404');

    // Table output renders.
    const table = await run(CmsDocumentsList, ['posts']);
    table.assertSucceeded();
    expect(logs(table)).toContain('page 1 of 1');
  });

  test('update, publish/unpublish, versions and restore through the REST handlers', async () => {
    const doc = (await cms.collection('posts').create({ title: 'v1' } as never)) as {
      id: string;
    };
    const updated = await json(CmsDocumentsUpdate, [
      'posts',
      doc.id,
      '--data',
      '{"title":"v2"}',
      '--as-system',
    ]);
    expect(updated.title).toBe('v2');

    (await run(CmsDocumentsUnpublish, ['posts', doc.id, '--as-system'])).assertSucceeded();
    expect(
      (
        (await cms.collection('posts').findByID(doc.id, { draft: true, overrideAccess: true })) as {
          _status: string;
        }
      )._status,
    ).toBe('draft');
    (await run(CmsDocumentsPublish, ['posts', doc.id, '--as-system'])).assertSucceeded();

    const versions = await json(CmsVersionsList, ['posts', doc.id]);
    expect(versions.meta.total).toBeGreaterThanOrEqual(2);
    const first = versions.data.at(-1).version;
    const shown = await json(CmsVersionsShow, ['posts', doc.id, String(first)]);
    expect(shown.version).toBe(first);

    const refused = await run(CmsVersionsRestore, ['posts', doc.id, String(first), '--as-system']);
    refused.assertFailed();
    expect(logs(refused)).toContain('pass --force');

    const restored = await json(CmsVersionsRestore, [
      'posts',
      doc.id,
      String(first),
      '--as-system',
      '--force',
    ]);
    expect(restored.title).toBe('v1');
  });

  test('delete asks unless --force, soft-deletes, and restore brings it back', async () => {
    const doc = (await cms.collection('posts').create({ title: 'bye' } as never)) as {
      id: string;
    };
    const refused = await run(CmsDocumentsDelete, ['posts', doc.id, '--as-system']);
    refused.assertFailed();
    expect(logs(refused)).toContain('pass --force');

    expect(await json(CmsDocumentsDelete, ['posts', doc.id, '--as-system', '--force'])).toEqual({
      ok: true,
    });
    expect((await json(CmsDocumentsList, ['posts'])).meta.total).toBe(0);
    expect((await json(CmsDocumentsList, ['posts', '--deleted'])).meta.total).toBe(1);

    (await run(CmsDocumentsRestore, ['posts', doc.id, '--as-system'])).assertSucceeded();
    expect((await json(CmsDocumentsList, ['posts'])).meta.total).toBe(1);
  });

  test('schedules a publish, shows it, cancels it; discards a pending draft', async () => {
    const doc = (await cms.collection('posts').create({ title: 'live' } as never)) as {
      id: string;
    };
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const bad = await run(CmsDocumentsSchedule, [
      'posts',
      doc.id,
      '--at',
      at,
      '--action',
      'explode',
      '--as-system',
    ]);
    bad.assertFailed();
    (
      await run(CmsDocumentsSchedule, [
        'posts',
        doc.id,
        '--at',
        at,
        '--action',
        'unpublish',
        '--as-system',
      ])
    ).assertSucceeded();
    const scheduled = await json(CmsDocumentsScheduled, ['posts', doc.id]);
    expect(scheduled.schedule).toMatchObject({ action: 'unpublish' });
    (await run(CmsDocumentsUnschedule, ['posts', doc.id, '--as-system'])).assertSucceeded();
    expect(await json(CmsDocumentsScheduled, ['posts', doc.id])).toEqual({ schedule: null });

    await cms.collection('posts').update(doc.id, { title: 'pending' } as never, { asDraft: true });
    (
      await run(CmsDocumentsDiscardDraft, ['posts', doc.id, '--as-system', '--force'])
    ).assertSucceeded();
    expect((await json(CmsDocumentsShow, ['posts', doc.id])).title).toBe('live');
  });

  test('globals: show and update', async () => {
    const updated = await json(CmsGlobalsUpdate, [
      'site',
      '--data',
      '{"name":"Agora"}',
      '--as-system',
    ]);
    expect(updated.name).toBe('Agora');
    expect((await json(CmsGlobalsShow, ['site'])).name).toBe('Agora');
  });
});
