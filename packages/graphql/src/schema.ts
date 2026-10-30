import type { Cms, CmsConfig, FieldConfig } from '@adonis-agora/cms';
import {
  GraphQLBoolean,
  type GraphQLFieldConfigMap,
  GraphQLFloat,
  GraphQLID,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
} from 'graphql';
import { GraphQLJSON } from './json-scalar.js';

/** ISO-8601 strings — GraphQLString would reject Date instances. */
const GraphQLDateTime = new GraphQLScalarType({
  name: 'DateTime',
  serialize: (value) => (value instanceof Date ? value.toISOString() : String(value)),
  parseValue: (value) => String(value),
  parseLiteral: (ast) => ('value' in ast ? String(ast.value) : null),
});

type ResolverArgs = {
  where?: unknown;
  sort?: string;
  limit?: number;
  page?: number;
  depth?: number;
  locale?: string;
  draft?: boolean;
  deleted?: boolean;
};

const pascal = (value: string): string =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

/**
 * Builds the GraphQL schema from the CMS config.
 *
 * Resolvers call the Local API, so access control, hooks, drafts, tenancy and i18n run exactly
 * as they do over REST — GraphQL is another shape over the same core, not a second engine.
 */
export function buildCmsGraphQLSchema(cms: Cms<CmsConfig>): GraphQLSchema {
  const config = cms.config;
  const query: GraphQLFieldConfigMap<unknown, unknown> = {};

  for (const collection of config.collections ?? []) {
    const typeName = pascal(collection.slug);
    const object = new GraphQLObjectType({
      name: typeName,
      fields: () => objectFields(collection.fields),
    });

    const listType = new GraphQLObjectType({
      name: `${typeName}List`,
      fields: {
        docs: { type: new GraphQLNonNull(new GraphQLList(object)) },
        totalDocs: { type: new GraphQLNonNull(GraphQLInt) },
        limit: { type: new GraphQLNonNull(GraphQLInt) },
        page: { type: new GraphQLNonNull(GraphQLInt) },
        totalPages: { type: new GraphQLNonNull(GraphQLInt) },
        hasNextPage: { type: new GraphQLNonNull(GraphQLBoolean) },
        hasPrevPage: { type: new GraphQLNonNull(GraphQLBoolean) },
      },
    });

    query[collection.slug] = {
      type: new GraphQLNonNull(listType),
      args: {
        where: { type: GraphQLJSON },
        sort: { type: GraphQLString },
        limit: { type: GraphQLInt },
        page: { type: GraphQLInt },
        depth: { type: GraphQLInt },
        locale: { type: GraphQLString },
        draft: { type: GraphQLBoolean },
        deleted: { type: GraphQLBoolean },
      },
      resolve: (_source, args: ResolverArgs) =>
        cms.collection(collection.slug).find({ ...args, depth: args.depth ?? 0 } as never),
    };

    query[`${collection.slug}ById`] = {
      type: object,
      args: {
        id: { type: new GraphQLNonNull(GraphQLID) },
        depth: { type: GraphQLInt },
        locale: { type: GraphQLString },
        draft: { type: GraphQLBoolean },
      },
      resolve: (_source, args: { id: string } & ResolverArgs) =>
        cms.collection(collection.slug).findByID(args.id, {
          depth: args.depth ?? 0,
          ...(args.locale !== undefined ? { locale: args.locale } : {}),
          ...(args.draft !== undefined ? { draft: args.draft } : {}),
        }),
    };
  }

  for (const global of config.globals ?? []) {
    const typeName = pascal(global.slug);
    const object = new GraphQLObjectType({
      name: typeName,
      fields: () => objectFields(global.fields),
    });

    query[global.slug] = {
      type: object,
      args: { locale: { type: GraphQLString } },
      resolve: (_source, args: { locale?: string }) =>
        cms.global(global.slug).get(args.locale ? { locale: args.locale } : {}),
    };
  }

  return new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: query }),
  });
}

function objectFields(
  fields: readonly FieldConfig[],
): GraphQLFieldConfigMap<Record<string, unknown>, unknown> {
  const output: GraphQLFieldConfigMap<Record<string, unknown>, unknown> = {
    id: { type: new GraphQLNonNull(GraphQLID) },
    createdAt: { type: GraphQLDateTime },
    updatedAt: { type: GraphQLDateTime },
    status: { type: GraphQLString, resolve: (doc) => doc._status ?? null },
  };

  for (const field of fields) {
    output[field.name] = { type: graphQLTypeFor(field) };
  }

  return output;
}

function graphQLTypeFor(field: FieldConfig) {
  if (field.localized) return GraphQLJSON;

  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'email':
    case 'password':
    case 'code':
    case 'slug':
    case 'select':
    case 'radio':
      return GraphQLString;
    case 'number':
      return GraphQLFloat;
    case 'checkbox':
      return GraphQLBoolean;
    case 'date':
      return GraphQLDateTime;
    case 'relation':
    case 'upload':
      return field.type === 'relation' && field.hasMany ? new GraphQLList(GraphQLID) : GraphQLID;
    default:
      return GraphQLJSON;
  }
}

export { GraphQLDateTime };
