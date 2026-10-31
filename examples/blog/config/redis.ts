import { defineConfig } from '@adonisjs/redis';

export default defineConfig({
  connection: 'main',
  connections: {
    main: {
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
    },
  },
});
