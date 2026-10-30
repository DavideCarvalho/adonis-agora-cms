import { Secret } from '@adonisjs/core/helpers';
import env from '#start/env';

export default {
  appKey: new Secret(env.get('APP_KEY')),
  http: {
    generateRequestId: true,
    useAsyncLocalStorage: false,
    cookie: {},
  },
};
