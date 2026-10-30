import { defineConfig } from '@adonisjs/core/app';

export default defineConfig({
  commands: [
    () => import('@adonisjs/core/commands'),
    () => import('@adonisjs/lucid/commands'),
    () => import('@adonis-agora/cms/commands'),
  ],
  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/lucid/database_provider'),
    () => import('@adonis-agora/cms/cms_provider'),
    () => import('@adonis-agora/cms-admin/cms_admin_provider'),
  ],
  preloads: [() => import('./start/kernel.js'), () => import('./start/routes.js')],
  directories: {
    controllers: 'app/controllers',
    migrations: 'database/migrations',
  },
  metaFiles: [],
});
