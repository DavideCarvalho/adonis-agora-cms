import router from '@adonisjs/core/services/router';

router.get('/', async () => ({ hello: 'blog example' }));

/**
 * A stand-in for a real frontend page. Each region the editor may change carries
 * `data-cms-field` with the CMS field name; the live-preview bridge outlines it and a click
 * jumps to that field in the admin.
 */
router.get('/preview/post', async ({ response }) => {
  response.type('text/html');
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Preview</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; padding: 40px; background: #09090b; color: #e7e7ea;
             font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.6; }
      article { max-width: 640px; margin: 0 auto; }
      h1 { font-size: 34px; margin: 0 0 8px; }
      h1, h2, p, img { padding: 4px 6px; border-radius: 6px; }
      h2 { font-size: 18px; color: #c084fc; margin: 28px 0 4px; }
      img { width: 100%; border-radius: 8px; }
      .muted { color: #76767f; font-size: 13px; }
    </style>
  </head>
  <body>
    <article>
      <div class="muted" data-cms-field="slug">hello-world</div>
      <h1 data-cms-field="title">Hello world</h1>
      <p data-cms-field="subtitle">Primeiro post</p>
      <div data-cms-field="banner"><img alt="" src="/placeholder.png" /></div>
      <div class="muted" data-cms-field="body">Hello body</div>
      <section data-cms-field="sections.0.heading">
        <h2>Abertura</h2>
      </section>
    </article>
    <script>
      // The admin injects the bridge for same-origin previews; a real site imports
      // previewBridge() from @adonis-agora/cms-react/preview instead.
    </script>
  </body>
</html>`;
});
