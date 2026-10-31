import server from '@adonisjs/core/services/server';

server.use([
  () => import('@adonisjs/core/bodyparser_middleware'),
  () => import('../app/middleware/demo_user_middleware.js'),
]);
