import router from '@adonisjs/core/services/router';
import server from '@adonisjs/core/services/server';

server.use([
  () => import('@adonisjs/core/bodyparser_middleware'),
  () => import('../app/middleware/demo_user_middleware.js'),
]);

// `CMS_AUTH=adonis` swaps the demo cookie for a real @adonisjs/auth session.
if (process.env.CMS_AUTH === 'adonis') {
  router.use([
    () => import('@adonisjs/session/session_middleware'),
    () => import('@adonisjs/auth/initialize_auth_middleware'),
  ]);
}
