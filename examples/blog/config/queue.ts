import { defineConfig, drivers } from '@adonisjs/queue';

// `sync` runs the job in the request's process. `CMS_QUEUE=redis` needs `node ace queue:work`.
export default defineConfig({
  default: process.env.CMS_QUEUE === 'redis' ? 'redis' : 'sync',
  adapters: { sync: drivers.sync(), redis: drivers.redis() },
  worker: { concurrency: 1, idleDelay: '200ms' },
  locations: ['./app/jobs/**/*.{ts,js}'],
});
