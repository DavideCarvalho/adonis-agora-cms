type FlagMetaData = {
  name: string;
  flagName: string;
  type: 'string' | 'boolean' | 'array' | 'number';
  required: boolean;
  description: string;
  alias?: string;
};

type ArgMetaData = {
  name: string;
  argumentName: string;
  type: 'string' | 'spread';
  required: boolean;
  description: string;
};

type CommandMetaData = {
  commandName: string;
  description: string;
  help: string;
  namespace: string;
  aliases: string[];
  flags: FlagMetaData[];
  args: ArgMetaData[];
  options: { startApp: boolean };
  filePath: string;
  /** The module's export holding the command class (default: `default`). */
  exportName?: string;
};

/**
 * Command metadata, mirroring what `@adonisjs/ace` generates for packages.
 *
 * Written by hand so listing commands never imports them (no build-time index step).
 */
const CONTENT_COMMANDS: CommandMetaData[] = [
  {
    commandName: 'cms:collections:list',
    description:
      'The content model: collections and globals, drafts/versions/soft delete, locales, tenancy',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
    ],
    args: [],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsCollectionsList',
  },
  {
    commandName: 'cms:collections:show',
    description:
      "A collection's or global's fields, and what documents:list can filter and sort by",
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
    ],
    args: [
      {
        name: 'slug',
        argumentName: 'slug',
        required: true,
        description: 'Collection or global slug',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsCollectionsShow',
  },
  {
    commandName: 'cms:documents:list',
    description: 'List documents of a collection (filters, sort, paging)',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
      {
        name: 'locale',
        flagName: 'locale',
        required: false,
        type: 'string',
        description: 'Locale of the content (none: localized fields as locale maps)',
      },
      {
        name: 'draft',
        flagName: 'draft',
        required: false,
        type: 'boolean',
        description: 'Read the latest draft (needs draft access)',
      },
      {
        name: 'depth',
        flagName: 'depth',
        required: false,
        type: 'number',
        description: 'How deep relationships are populated (default 0)',
      },
      {
        name: 'select',
        flagName: 'select',
        required: false,
        type: 'array',
        description: 'Only these fields (repeat)',
      },
      {
        name: 'filter',
        flagName: 'filter',
        required: false,
        type: 'string',
        description:
          'Filters as a JSON object: {"title":{"contains":"news"},"_status":"published"}',
      },
      {
        name: 'sort',
        flagName: 'sort',
        required: false,
        type: 'string',
        description: 'Sort, e.g. -createdAt or title,-updatedAt',
      },
      {
        name: 'page',
        flagName: 'page',
        required: false,
        type: 'number',
        description: 'Page (1-based)',
      },
      {
        name: 'size',
        flagName: 'size',
        required: false,
        type: 'number',
        description: 'Page size',
      },
      {
        name: 'deleted',
        flagName: 'deleted',
        required: false,
        type: 'boolean',
        description: 'Include soft-deleted documents',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsDocumentsList',
  },
  {
    commandName: 'cms:documents:show',
    description: 'One document by id',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
      {
        name: 'locale',
        flagName: 'locale',
        required: false,
        type: 'string',
        description: 'Locale of the content (none: localized fields as locale maps)',
      },
      {
        name: 'draft',
        flagName: 'draft',
        required: false,
        type: 'boolean',
        description: 'Read the latest draft (needs draft access)',
      },
      {
        name: 'depth',
        flagName: 'depth',
        required: false,
        type: 'number',
        description: 'How deep relationships are populated (default 0)',
      },
      {
        name: 'select',
        flagName: 'select',
        required: false,
        type: 'array',
        description: 'Only these fields (repeat)',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsDocumentsShow',
  },
  {
    commandName: 'cms:documents:create',
    description: 'Create a document (access, hooks and validation apply)',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
      {
        name: 'data',
        flagName: 'data',
        required: true,
        type: 'string',
        description: 'Field values: a JSON object, or @file.json',
      },
      {
        name: 'draft',
        flagName: 'draft',
        required: false,
        type: 'boolean',
        description: 'Keep it as a draft (create unpublished / edit as pending draft)',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsDocumentsCreate',
  },
  {
    commandName: 'cms:documents:update',
    description: 'Update fields of a document (unlisted fields are kept)',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
      {
        name: 'data',
        flagName: 'data',
        required: true,
        type: 'string',
        description: 'Field values: a JSON object, or @file.json',
      },
      {
        name: 'draft',
        flagName: 'draft',
        required: false,
        type: 'boolean',
        description: 'Keep it as a draft (create unpublished / edit as pending draft)',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsDocumentsUpdate',
  },
  {
    commandName: 'cms:documents:delete',
    description:
      'Delete a document (soft delete moves it to the trash; --permanent removes it). Asks unless --force',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
      {
        name: 'permanent',
        flagName: 'permanent',
        required: false,
        type: 'boolean',
        description: 'Remove for good instead of trashing',
      },
      {
        name: 'force',
        flagName: 'force',
        required: false,
        type: 'boolean',
        description: 'Do not ask for confirmation',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsDocumentsDelete',
  },
  {
    commandName: 'cms:documents:restore',
    description: 'Bring a soft-deleted document back from the trash',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsDocumentsRestore',
  },
  {
    commandName: 'cms:documents:publish',
    description: "Publish a document's latest draft",
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsDocumentsPublish',
  },
  {
    commandName: 'cms:documents:unpublish',
    description: 'Take a published document offline (back to draft)',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsDocumentsUnpublish',
  },
  {
    commandName: 'cms:documents:discard-draft',
    description: 'Drop the pending draft of a published document. Asks unless --force',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
      {
        name: 'force',
        flagName: 'force',
        required: false,
        type: 'boolean',
        description: 'Do not ask for confirmation',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsDocumentsDiscardDraft',
  },
  {
    commandName: 'cms:documents:schedule',
    description: 'Schedule a publish or unpublish at a date',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
      {
        name: 'at',
        flagName: 'at',
        required: true,
        type: 'string',
        description: 'When (ISO-8601)',
      },
      {
        name: 'action',
        flagName: 'action',
        required: false,
        type: 'string',
        description: 'publish (default) or unpublish',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsDocumentsSchedule',
  },
  {
    commandName: 'cms:documents:unschedule',
    description: "Cancel a document's scheduled publish or unpublish",
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsDocumentsUnschedule',
  },
  {
    commandName: 'cms:documents:scheduled',
    description: "A document's scheduled publish or unpublish, if any",
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsDocumentsScheduled',
  },
  {
    commandName: 'cms:versions:list',
    description: "A document's version history, newest first",
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
      {
        name: 'locale',
        flagName: 'locale',
        required: false,
        type: 'string',
        description: 'Only versions of this locale',
      },
      {
        name: 'page',
        flagName: 'page',
        required: false,
        type: 'number',
        description: 'Page (1-based)',
      },
      {
        name: 'size',
        flagName: 'size',
        required: false,
        type: 'number',
        description: 'Page size',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsVersionsList',
  },
  {
    commandName: 'cms:versions:show',
    description: 'One version of a document (--snapshot adds its content)',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
      {
        name: 'snapshot',
        flagName: 'snapshot',
        required: false,
        type: 'boolean',
        description: 'Include the full content (needs draft access)',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
      {
        name: 'version',
        argumentName: 'version',
        required: true,
        description: 'Version number',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsVersionsShow',
  },
  {
    commandName: 'cms:versions:restore',
    description:
      "Replace a document's content with one of its versions (history is kept). Asks unless --force",
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
      {
        name: 'force',
        flagName: 'force',
        required: false,
        type: 'boolean',
        description: 'Do not ask for confirmation',
      },
    ],
    args: [
      {
        name: 'collection',
        argumentName: 'collection',
        required: true,
        description: 'Collection slug',
        type: 'string',
      },
      {
        name: 'id',
        argumentName: 'id',
        required: true,
        description: 'Document id',
        type: 'string',
      },
      {
        name: 'version',
        argumentName: 'version',
        required: true,
        description: 'Version number',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsVersionsRestore',
  },
  {
    commandName: 'cms:globals:show',
    description: 'A global (single-row document)',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
      {
        name: 'locale',
        flagName: 'locale',
        required: false,
        type: 'string',
        description: 'Locale of the content (none: localized fields as locale maps)',
      },
      {
        name: 'draft',
        flagName: 'draft',
        required: false,
        type: 'boolean',
        description: 'Read the latest draft (needs draft access)',
      },
      {
        name: 'depth',
        flagName: 'depth',
        required: false,
        type: 'number',
        description: 'How deep relationships are populated (default 0)',
      },
      {
        name: 'select',
        flagName: 'select',
        required: false,
        type: 'array',
        description: 'Only these fields (repeat)',
      },
    ],
    args: [
      {
        name: 'slug',
        argumentName: 'slug',
        required: true,
        description: 'Global slug',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsGlobalsShow',
  },
  {
    commandName: 'cms:globals:update',
    description: 'Update fields of a global (unlisted fields are kept)',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'token',
        flagName: 'token',
        required: false,
        type: 'string',
        description: 'CMS API token to act as (default: the CMS_API_TOKEN env var)',
      },
      {
        name: 'asSystem',
        flagName: 'as-system',
        required: false,
        type: 'boolean',
        description:
          'Write with no principal: access rules run with no user (needs no token); refused without it',
      },
      {
        name: 'tenant',
        flagName: 'tenant',
        required: false,
        type: 'string',
        description: 'Tenant (with a token: needs its tenant:switch ability)',
      },
      {
        name: 'json',
        flagName: 'json',
        required: false,
        type: 'boolean',
        description: 'Print JSON',
      },
      {
        name: 'data',
        flagName: 'data',
        required: true,
        type: 'string',
        description: 'Field values: a JSON object, or @file.json',
      },
    ],
    args: [
      {
        name: 'slug',
        argumentName: 'slug',
        required: true,
        description: 'Global slug',
        type: 'string',
      },
    ],
    options: {
      startApp: true,
    },
    filePath: 'content.js',
    exportName: 'CmsGlobalsUpdate',
  },
];

const COMMANDS: CommandMetaData[] = [
  {
    commandName: 'cms:diff',
    description: 'Show the schema changes the CMS config would apply',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'json',
        flagName: 'json',
        type: 'boolean',
        required: false,
        description: 'Print the plan as JSON',
        alias: 'j',
      },
      {
        name: 'connection',
        flagName: 'connection',
        type: 'string',
        required: false,
        description: 'Database connection to inspect',
        alias: 'c',
      },
    ],
    args: [],
    options: { startApp: true },
    filePath: 'diff.js',
  },
  {
    commandName: 'cms:sync',
    description: 'Apply the CMS schema to the database',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'dryRun',
        flagName: 'dry-run',
        type: 'boolean',
        required: false,
        description: 'Show the plan without applying it',
        alias: 'd',
      },
      {
        name: 'allowDestructive',
        flagName: 'allow-destructive',
        type: 'boolean',
        required: false,
        description: 'Allow dropping tables/columns',
      },
      {
        name: 'force',
        flagName: 'force',
        type: 'boolean',
        required: false,
        description: 'Shorthand for --allow-destructive',
        alias: 'f',
      },
      {
        name: 'connection',
        flagName: 'connection',
        type: 'string',
        required: false,
        description: 'Database connection to use',
        alias: 'c',
      },
    ],
    args: [],
    options: { startApp: true },
    filePath: 'sync.js',
  },
  {
    commandName: 'cms:generate',
    description: 'Generate a Lucid migration for the current CMS schema',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'connection',
        flagName: 'connection',
        type: 'string',
        required: false,
        description: 'Database connection used to detect the engine',
        alias: 'c',
      },
    ],
    args: [],
    options: { startApp: true },
    filePath: 'generate.js',
  },
  {
    commandName: 'cms:partitions',
    description: 'Create and prune monthly cms_versions partitions (Postgres)',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'monthsAhead',
        flagName: 'months-ahead',
        type: 'number',
        required: false,
        description: 'How many months ahead to create',
        alias: 'm',
      },
      {
        name: 'retentionMonths',
        flagName: 'retention-months',
        type: 'number',
        required: false,
        description: 'Drop partitions older than N months',
      },
      {
        name: 'connection',
        flagName: 'connection',
        type: 'string',
        required: false,
        description: 'Database connection to use',
        alias: 'c',
      },
    ],
    args: [],
    options: { startApp: true },
    filePath: 'partitions.js',
  },
  {
    commandName: 'cms:status',
    description: 'Show the CMS schema state and document counts',
    help: '',
    namespace: 'cms',
    aliases: [],
    flags: [
      {
        name: 'json',
        flagName: 'json',
        type: 'boolean',
        required: false,
        description: 'Print status as JSON',
        alias: 'j',
      },
      {
        name: 'connection',
        flagName: 'connection',
        type: 'string',
        required: false,
        description: 'Database connection to inspect',
        alias: 'c',
      },
    ],
    args: [],
    options: { startApp: true },
    filePath: 'status.js',
  },
  // The content commands (`cms:collections:*`, `cms:documents:*`, `cms:versions:*`,
  // `cms:globals:*`) live in content.js. A test checks this list against the classes.
  ...CONTENT_COMMANDS,
];

export async function getMetaData(): Promise<CommandMetaData[]> {
  return COMMANDS;
}

export async function getCommand(metaData: { commandName: string }): Promise<unknown> {
  const command = COMMANDS.find((item) => item.commandName === metaData.commandName);
  if (!command) return null;

  const module = (await import(new URL(command.filePath, import.meta.url).href)) as Record<
    string,
    unknown
  >;
  return module[command.exportName ?? 'default'];
}
