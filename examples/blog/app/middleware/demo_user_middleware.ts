import type { HttpContext } from '@adonisjs/core/http';
import type { NextFn } from '@adonisjs/core/types/http';

/**
 * The example has no login. A `cms_demo_user` cookie plays the signed-in editor, so drafts and
 * document locks (which need a user) can be exercised. Never do this in a real app.
 */
export default class DemoUserMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const cookie = ctx.request.header('cookie') ?? '';
    const name = /(?:^|;\s*)cms_demo_user=([^;]+)/.exec(cookie)?.[1];
    if (name) (ctx as unknown as { auth: unknown }).auth = { user: { id: name } };
    return next();
  }
}
