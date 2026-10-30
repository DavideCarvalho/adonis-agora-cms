/**
 * Blog example — real CMS stack, no fixtures.
 *
 * SQLite + the compiled schema + the real REST handlers + the built admin SPA. Only the
 * AdonisJS HTTP kernel is absent; everything the panel touches is production code.
 */

import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import knex from 'knex';
import {
  collection,
  createCms,
  defineConfig,
  fields,
  global,
  syncCmsSchema,
} from '../../packages/adonis/dist/src/index.js';
import {
  handleAdminSchema,
  handleCollectionCreate,
  handleCollectionFind,
  handleCollectionFindOne,
  handleCollectionUpdate,
} from '../../packages/adonis/dist/src/rest/index.js';

const config = defineConfig({
  db: { id: 'uuid', tablePrefix: 'cms_' },
  localization: { locales: ['pt-BR'], defaultLocale: 'pt-BR' },
  versions: { drafts: true },
  collections: [
    collection('posts', {
      labels: { singular: 'Post', plural: 'Posts' },
      admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug'] },
      fields: [
        fields.text('title', { required: true }),
        fields.slug('slug', { from: 'title', unique: true }),
        fields.richText('body'),
        fields.select('status', {
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        }),
      ],
    }),
  ],
  globals: [global('settings', { fields: [fields.text('siteName')] })],
});

const db = knex({
  client: 'better-sqlite3',
  connection: { filename: ':memory:' },
  useNullAsDefault: true,
});
const client = db;
const spec = (await import('../../packages/adonis/dist/src/schema/index.js')).compileSchema(
  config,
  {
    engine: 'sqlite',
  },
);
await syncCmsSchema(client, spec, { engine: 'sqlite' });

const cms = createCms({ config, client, user: { id: 'editor' } });
const existing = await cms.collection('posts').find({ depth: 0 });
if (existing.totalDocs === 0) {
  await cms.collection('posts').create({
    title: 'Hello world',
    status: 'published',
    body: { type: 'doc', content: [{ type: 'paragraph', text: 'First post' }] },
  });
}

const SPA = new URL('../../packages/admin/dist/spa/', import.meta.url);
const TYPES = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const body = await readBody(req);

  if (url.pathname.startsWith('/api/cms/')) {
    const response = await route(url, body);
    return json(res, response.status, response.body);
  }

  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const raw = await readFile(new URL(`.${file}`, SPA));
    const payload =
      extname(file) === '.html' ? raw.toString('utf8').replaceAll('/__CMS_ADMIN__/', '/') : raw;
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(payload);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(5611, () => console.log('blog example on http://127.0.0.1:5611'));

async function route(url, body) {
  const parts = url.pathname.split('/').filter(Boolean); // api, cms, ...
  const [, , resource, slug, id] = parts;
  const request = { params: { slug, id }, query: Object.fromEntries(url.searchParams), body };

  if (resource === 'schema') return handleAdminSchema(cms);
  if (resource === 'collections' && slug && id) {
    if (request.query && Object.keys(request.query).length === 0) request.query = {};
    return body === undefined
      ? handleCollectionFindOne(cms, request)
      : handleCollectionUpdate(cms, request);
  }
  if (resource === 'collections' && slug) {
    return body === undefined
      ? handleCollectionFind(cms, request)
      : handleCollectionCreate(cms, request);
  }
  return { status: 404, body: { error: { code: 'CMS_NOT_FOUND', message: 'route' } } };
}

function readBody(req) {
  if (req.method === 'GET' || req.method === 'DELETE') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
