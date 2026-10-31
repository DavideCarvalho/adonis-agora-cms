import app from '@adonisjs/core/services/app';
import { defineConfig, services } from '@adonisjs/drive';

export default defineConfig({
  default: 'fs',
  services: {
    fs: services.fs({
      location: app.makePath('storage/uploads'),
      serveFiles: true,
      routeBasePath: '/files',
      visibility: 'public',
    }),
  },
});
