import { defineConfig, symbols } from '@adonisjs/auth';
import { sessionGuard } from '@adonisjs/auth/session';

type DemoUser = { id: string };

// No users table in this example: anyone logging in through `/dev-login` exists by name.
const createUserForGuard = async (user: DemoUser) => ({
  getId: () => user.id,
  getOriginal: () => user,
});

export default defineConfig({
  default: 'web',
  guards: {
    web: sessionGuard({
      useRememberMeTokens: false,
      provider: {
        [symbols.PROVIDER_REAL_USER]: undefined as unknown as DemoUser,
        createUserForGuard,
        findById: async (id) => createUserForGuard({ id: String(id) }),
      },
    }),
  },
});
