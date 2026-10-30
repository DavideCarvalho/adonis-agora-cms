import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyPreviewToken } from '@adonis-agora/cms';
import cms from '@adonis-agora/cms/services/main';
import app from '@adonisjs/core/services/app';
import router from '@adonisjs/core/services/router';
import { renderPage, renderPost } from '../app/pages/render.js';

const PREVIEW_SECRET = 'local-preview-secret';

router.get('/', async () => ({ hello: 'blog example' }));

/** A published page, rendered through the `slug → block` map. */
router.get('/p/:slug', async ({ params, response }) => {
  const { docs } = await cms.collection('pages').find({
    where: { slug: { equals: params.slug } },
  });

  const page = docs[0];
  if (!page) return response.status(404).send('page not found');

  response.type('html');
  return renderPage(page);
});

/**
 * Live preview: the admin signs a short-lived token for the document being edited, the site
 * verifies it here and renders the draft — no session, no public draft URL.
 */
router.get('/preview', async ({ request, response }) => {
  const token = String(request.qs().token ?? '');
  const claims = verifyPreviewToken(token, PREVIEW_SECRET);
  if (!claims) return response.status(401).send('invalid or expired preview token');

  const scoped = cms.forTenant(claims.tenant);
  const doc = await scoped.collection(claims.collection).findByID(claims.documentId, {
    draft: true,
    overrideAccess: true,
  });

  if (!doc) return response.status(404).send('document not found');

  response.type('html');
  return claims.collection === 'pages' ? renderPage(doc) : renderPost(doc);
});

/** Files the upload handler wrote; the example has no CDN. */
router.get('/uploads/*', async ({ params, response }) => {
  const path = String((params as Record<string, unknown>)['*'] ?? '');
  if (!path || path.includes('..')) return response.status(400).send('bad path');

  const file = await readFile(join(app.makePath('storage/uploads'), path)).catch(() => null);
  if (!file) return response.status(404).send('not found');

  response.header('content-type', mimeFor(path));
  return response.send(file);
});

function mimeFor(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}
