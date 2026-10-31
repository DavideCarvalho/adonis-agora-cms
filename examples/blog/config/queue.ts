import { defineConfig, drivers } from '@adonisjs/queue';

// `sync` runs the job in the request's process, which is enough for a local example.
export default defineConfig({
  default: 'sync',
  adapters: { sync: drivers.sync() },
  worker: { concurrency: 1, idleDelay: '2s' },
  locations: ['./app/jobs/**/*.{ts,js}'],
});
