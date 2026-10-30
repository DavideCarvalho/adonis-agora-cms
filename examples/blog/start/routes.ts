import { createCms } from '@adonis-agora/cms';
import type { CmsKnex } from '@adonis-agora/cms/db';
import { createCmsYoga } from '@adonis-agora/cms-graphql';
import router from '@adonisjs/core/services/router';
import db from '@adonisjs/lucid/services/db';
import cmsConfig from '#config/cms';

// Built lazily: routes are preloaded before the database provider boots.
let yoga: ReturnType<typeof createCmsYoga> | undefined;
const getYoga = () => {
  yoga ??= createCmsYoga(
    createCms({ config: cmsConfig, client: db.connection().getWriteClient() as unknown as CmsKnex }),
  );
  return yoga;
};

router.get('/', async () => ({ hello: 'blog example' }));
// The Adonis bodyparser already consumed the stream, so the parsed body is re-wrapped in a
// Request for Yoga instead of handing it the raw stream.
router.post('/graphql', async ({ request, response }) => {
  const result = await getYoga().fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request.body()),
  });

  response.status(result.status).header('content-type', 'application/json');
  return response.send(await result.text());
});
