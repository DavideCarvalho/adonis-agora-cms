import 'reflect-metadata';
import { pathToFileURL } from 'node:url';
import { AuthzService } from '@adonis-agora/authz';
import { WorkflowEngine } from '@adonis-agora/durable';
import { MediaManager } from '@adonis-agora/media';
import { describe, expect, test, vi } from 'vitest';
import {
  access,
  auth,
  collection,
  defineConfig,
  fields,
  jobs,
  media,
  observers,
  uploads,
} from '../../src/index.js';
import type { CmsApp } from '../../src/integrations/container.js';
import { buildAdapters } from '../../src/integrations/factories.js';

const file = { filename: 'a.png', mimeType: 'image/png', size: 1, contents: new Uint8Array([1]) };
const context = { field: 'cover', collection: 'posts' };
const secret = 'test-only-secret-not-for-production-0123';

function appWith(bindings: [unknown, unknown][]): CmsApp {
  const found = new Map(bindings);
  return {
    appRoot: pathToFileURL(`${process.cwd()}/`),
    container: {
      make: (async (binding: unknown) => found.get(binding)) as never,
      hasBinding: ((binding: unknown) => found.has(binding)) as never,
    },
  };
}

const build = (integrations: object, app: CmsApp) =>
  buildAdapters(
    defineConfig({ collections: [], integrations, ...{ db: { id: 'uuid' } } }) as never,
    app,
  ) as Promise<{ integrations: Record<string, never> }>;

describe('factories, built at boot', () => {
  test('nothing is resolved while the config file loads', () => {
    expect(() => [
      jobs.durable(),
      media.library(),
      uploads.drive(),
      observers.logger(),
    ]).not.toThrow();
  });

  test('a missing library stops the boot and says which one', async () => {
    const app = appWith([]);
    await expect(build({ media: media.drive() }, app)).rejects.toThrow(/@adonisjs\/drive/);
    await expect(build({ jobs: jobs.durable() }, app)).rejects.toThrow(/WorkflowEngine/);
    await expect(build({ auth: auth.builtin({ secret, mail: true }) }, app)).rejects.toThrow(
      /@adonisjs\/mail/,
    );
  });

  test('drive: the default disk, or a named one', async () => {
    const disk = { put: vi.fn(), getUrl: async (key: string) => `/${key}` };
    const use = vi.fn(() => disk);
    const app = appWith([['drive.manager', { use }]]);

    await (await uploads.drive().create(app))(file, context);
    expect(use).toHaveBeenLastCalledWith();
    await (await uploads.drive({ disk: 's3' }).create(app))(file, context);
    expect(use).toHaveBeenLastCalledWith('s3');
  });

  test('mail: the manager, or a named mailer', async () => {
    const send = vi.fn();
    const named = vi.fn();
    const app = appWith([['mail.manager', { send, use: () => ({ send: named }) }]]);
    const message = { to: 'a@b.c', subject: 's', text: 't' };

    await (await auth.builtin({ secret, mail: true }).create(app)).builtin.mail?.send(message);
    expect(send).toHaveBeenCalledOnce();
    await (await auth.builtin({ secret, mail: 'smtp' }).create(app)).builtin.mail?.send(message);
    expect(named).toHaveBeenCalledOnce();
  });

  test('durable: the class of the installed library finds the engine', async () => {
    const start = vi.fn();
    const app = appWith([[WorkflowEngine, { start }]]);

    await (await jobs.durable().create(app)).deliverWebhook({} as never);
    expect(start.mock.calls[0]?.[0]).toBe('cms.deliver-webhook');
  });

  test('media library: the class of the installed library finds the manager', async () => {
    const find = vi.fn(async (id: string) => ({ id, url: `/${id}` }));
    const app = appWith([[MediaManager, { library: { find } }]]);

    const resolved = await (await media.library().create(app)).resolveMany(['a']);
    expect(resolved.get('a')?.url).toBe('/a');
  });

  test('authz: the rules of a collection are built, and a guest is refused', async () => {
    const can = vi.fn(async () => true);
    const config = defineConfig({
      db: { id: 'uuid' },
      collections: [
        collection('posts', { access: access.authz('posts'), fields: [fields.text('title')] }),
      ],
    });
    const built = await buildAdapters(config as never, appWith([[AuthzService, { can }]]));
    const rule = built.collections?.[0]?.access?.update;

    await expect(rule?.({ req: null, user: { id: 1 } })).resolves.toBe(true);
    expect(can).toHaveBeenCalledWith({ id: 1 }, 'posts.update');
    await expect(rule?.({ req: null, user: null })).resolves.toBe(false);
  });

  test('an unbuilt authz rule refuses instead of allowing', () => {
    expect(() => access.authz('posts').read({ req: null, user: { id: 1 } })).toThrow(/booted app/);
  });

  test('queue: a lazily imported job is dispatched', async () => {
    const dispatch = vi.fn();
    const input = {} as never;

    await jobs.queue(async () => ({ default: { dispatch } })).deliverWebhook(input);
    expect(dispatch).toHaveBeenCalledWith(input);
  });

  test('logger: a failure never reaches the write', async () => {
    const info = vi.fn();
    const observation = { collection: 'p', operation: 'create', durationMs: 1, ok: true } as const;

    (await observers.logger().create(appWith([['logger', { info, error: vi.fn() }]])))(observation);
    await vi.waitFor(() => expect(info).toHaveBeenCalledOnce());
  });
});
