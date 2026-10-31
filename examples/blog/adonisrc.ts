import { defineConfig } from '@adonisjs/core/app';

export default defineConfig({
  commands: [
    () => import('@adonisjs/core/commands'),
    () => import('@adonisjs/lucid/commands'),
    () => import('@adonis-agora/cms/commands'),
    () => import('@adonisjs/queue/commands'),
    ...(process.env.CMS_JOBS === 'durable' ? [() => import('@adonis-agora/durable/commands')] : []),
  ],
  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/lucid/database_provider'),
    () => import('@adonisjs/session/session_provider'),
    () => import('@adonisjs/auth/auth_provider'),
    () => import('@adonisjs/redis/redis_provider'),
    () => import('@adonisjs/mail/mail_provider'),
    () => import('@adonisjs/drive/drive_provider'),
    () => import('@adonisjs/queue/queue_provider'),
    // Only with `CMS_JOBS=durable`: an app picks one queue, and this one needs its own worker setup.
    ...(process.env.CMS_JOBS === 'durable'
      ? [() => import('@adonis-agora/durable/durable_provider')]
      : []),
    () => import('@adonis-agora/cms/cms_provider'),
    () => import('@adonis-agora/cms-admin/cms_admin_provider'),
  ],
  preloads: [() => import('./start/kernel.js'), () => import('./start/routes.js')],
  hooks: {
    init:
      process.env.CMS_JOBS === 'durable'
        ? [() => import('@adonis-agora/durable/hooks/workflows')]
        : [],
  },
  directories: {
    controllers: 'app/controllers',
    migrations: 'database/migrations',
  },
  metaFiles: [],
});
