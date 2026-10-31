import { defineConfig, transports } from '@adonisjs/mail';

export default defineConfig({
  default: 'smtp',
  from: { address: 'cms@example.test', name: 'Blog CMS' },
  mailers: {
    smtp: transports.smtp({
      host: process.env.SMTP_HOST ?? '127.0.0.1',
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: false,
    }),
  },
});
