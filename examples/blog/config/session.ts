import { defineConfig, stores } from '@adonisjs/session';

export default defineConfig({
  enabled: true,
  age: '2h',
  cookieName: 'blog-session',
  clearWithBrowser: false,
  store: 'cookie',
  cookie: { path: '/', httpOnly: true, secure: false, sameSite: 'lax' },
  stores: { cookie: stores.cookie() },
});
