import type { Cms, CmsConfig } from '@adonis-agora/cms';
import { createYoga, type YogaServerInstance } from 'graphql-yoga';
import { buildCmsGraphQLSchema } from './schema.js';

export type CmsYogaOptions = {
  graphqlEndpoint?: string;
  /** Extra Yoga options (cors, logging, context). */
  yoga?: Parameters<typeof createYoga>[0];
};

/**
 * Yoga instance bound to the CMS.
 *
 * Mount it on a route: `router.any('/graphql', (ctx) => yoga.handle(ctx.request.request, ctx.response.response))`.
 */
export function createCmsYoga(
  cms: Cms<CmsConfig>,
  options: CmsYogaOptions = {},
): YogaServerInstance<Record<string, unknown>, Record<string, unknown>> {
  return createYoga({
    ...options.yoga,
    schema: buildCmsGraphQLSchema(cms),
    graphqlEndpoint: options.graphqlEndpoint ?? '/graphql',
  });
}
