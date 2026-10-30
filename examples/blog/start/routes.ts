import router from '@adonisjs/core/services/router';

router.get('/', async () => ({ hello: 'blog example' }));
