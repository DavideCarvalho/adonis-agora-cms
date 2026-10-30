import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';

const spa = new URL('../packages/admin/dist/spa/', import.meta.url);
const schema = {
  version: 1,
  admin: { title: 'Blog', path: '/admin' },
  locales: ['pt-BR'],
  defaultLocale: 'pt-BR',
  tenancy: { strategy: 'single', required: false },
  collections: [
    {
      slug: 'posts',
      kind: 'collection',
      labels: { singular: 'Post', plural: 'Posts' },
      admin: { useAsTitle: 'title', defaultColumns: ['title', 'slug'] },
      versioned: true,
      drafts: true,
      fields: [
        { type: 'text', name: 'title', required: true },
        { type: 'slug', name: 'slug' },
        {
          type: 'select',
          name: 'status',
          options: [
            { label: 'Draft', value: 'draft' },
            { label: 'Published', value: 'published' },
          ],
        },
      ],
    },
  ],
  globals: [],
  user: { id: 'e2e' },
  permissions: { posts: { read: true, create: true, update: true, delete: true } },
};
const docs = [{ id: '1', title: 'Hello world', slug: 'hello-world', _status: 'published' }];

const types = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/cms/schema') return json(res, schema);
  if (url.pathname === '/api/cms/collections/posts') {
    return json(res, {
      docs,
      totalDocs: 1,
      limit: 20,
      page: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
    });
  }
  if (url.pathname.startsWith('/api/cms/collections/posts/')) return json(res, docs[0]);
  const file = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const raw = await readFile(new URL(`.${file}`, spa));
    const body =
      extname(file) === '.html' ? raw.toString('utf8').replaceAll('/__CMS_ADMIN__/', '/') : raw;
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(5610, () => console.log('e2e server on 5610'));

function json(res, body) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
