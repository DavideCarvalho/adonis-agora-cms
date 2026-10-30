import { defineConfig } from '@adonisjs/core/bodyparser';

export default defineConfig({
  allowedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  form: { limit: '1mb', types: ['application/x-www-form-urlencoded'] },
  json: { limit: '1mb', strict: false, types: ['application/json', 'application/*+json'] },
  multipart: {
    limit: '1mb',
    types: ['multipart/form-data'],
    // Multipart is parsed only on the CMS upload route — everything else stays manual.
    autoProcess: ['/api/cms/uploads'],
    processManually: [],
  },
});
