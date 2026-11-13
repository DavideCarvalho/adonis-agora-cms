import { args, flags } from '@adonisjs/core/ace';
import {
  handleCollectionCreate,
  handleCollectionDelete,
  handleCollectionDiscardDraft,
  handleCollectionFind,
  handleCollectionFindOne,
  handleCollectionPublish,
  handleCollectionRestore,
  handleCollectionRestoreVersion,
  handleCollectionSchedule,
  handleCollectionScheduled,
  handleCollectionUnpublish,
  handleCollectionUnschedule,
  handleCollectionUpdate,
  handleCollectionVersion,
  handleCollectionVersions,
  handleGlobalGet,
  handleGlobalUpdate,
} from '../rest/handlers.js';
import { CmsCliRefusal, CmsContentCommand, cell, jsonObjectFlag } from './console.js';

/** The read options a REST query string carries (`locale`, `draft`, `depth`, `select`). */
abstract class ReadCommand extends CmsContentCommand {
  @flags.string({ description: 'Locale of the content (none: localized fields as locale maps)' })
  declare locale?: string;

  @flags.boolean({ description: 'Read the latest draft (needs draft access)' })
  declare draft?: boolean;

  @flags.number({ description: 'How deep relationships are populated (default 0)' })
  declare depth?: number;

  @flags.array({ description: 'Only these fields (repeat)' })
  declare select?: string[];

  protected readQuery(): Record<string, unknown> {
    return {
      ...(this.locale ? { locale: this.locale } : {}),
      ...(this.draft ? { draft: 'true' } : {}),
      ...(this.depth !== undefined ? { depth: String(this.depth) } : {}),
      ...(this.select && this.select.length > 0 ? { select: this.select } : {}),
    };
  }
}

export class CmsCollectionsList extends CmsContentCommand {
  static override commandName = 'cms:collections:list';
  static override description =
    'The content model: collections and globals, drafts/versions/soft delete, locales, tenancy';

  override async run() {
    const out = await this.modelTool('cms_list_collections', {});
    if (this.json) return this.printJson(out);
    this.table(out.items as Record<string, unknown>[], [
      'slug',
      'kind',
      'versioned',
      'drafts',
      'softDelete',
    ]);
    this.logger.info(
      `locales: ${((out.locales as string[]) ?? []).join(', ') || 'none'} · tenancy: ${String(out.tenancy)}`,
    );
  }
}

export class CmsCollectionsShow extends CmsContentCommand {
  static override commandName = 'cms:collections:show';
  static override description =
    "A collection's or global's fields, and what documents:list can filter and sort by";

  @args.string({ description: 'Collection or global slug' })
  declare slug: string;

  override async run() {
    const out = await this.modelTool('cms_get_collection', { slug: this.slug });
    if (this.json) return this.printJson(out);
    this.table(out.fields as Record<string, unknown>[], [
      'name',
      'type',
      'required',
      'localized',
      'relationTo',
      'options',
    ]);
    if (out.filterable) {
      this.logger.info(`filterable: ${(out.filterable as string[]).join(', ')}`);
      this.logger.info(`sortable: ${(out.sortable as string[]).join(', ')}`);
    }
  }
}

/** The list envelope: `{ data, meta: { total, perPage, currentPage, lastPage } }`. */
type Page = {
  data: Record<string, unknown>[];
  meta: { total: number; currentPage: number; lastPage: number };
};

export class CmsDocumentsList extends ReadCommand {
  static override commandName = 'cms:documents:list';
  static override description = 'List documents of a collection (filters, sort, paging)';

  @args.string({ description: 'Collection slug' })
  declare collection: string;

  @flags.string({
    description: 'Filters as a JSON object: {"title":{"contains":"news"},"_status":"published"}',
  })
  declare filter?: string;

  @flags.string({ description: 'Sort, e.g. -createdAt or title,-updatedAt' })
  declare sort?: string;

  @flags.number({ description: 'Page (1-based)' })
  declare page?: number;

  @flags.number({ description: 'Page size' })
  declare size?: number;

  @flags.boolean({ description: 'Include soft-deleted documents' })
  declare deleted?: boolean;

  override async run() {
    const filter = this.filter !== undefined ? await jsonObjectFlag(this.filter, 'filter') : {};
    const body = (await this.rest({ write: false, slug: this.collection }, handleCollectionFind, {
      params: { slug: this.collection },
      query: {
        ...this.readQuery(),
        ...(Object.keys(filter).length > 0 ? { filter } : {}),
        ...(this.sort ? { sort: this.sort } : {}),
        ...(this.page !== undefined ? { page: String(this.page) } : {}),
        ...(this.size !== undefined ? { size: String(this.size) } : {}),
        ...(this.deleted ? { deleted: 'true' } : {}),
      },
    })) as Page;
    if (this.json) return this.printJson(body);
    const columns = ['id', ...titleColumns(body.data), '_status', 'updatedAt'].filter((column) =>
      body.data.some((doc) => doc[column] !== undefined),
    );
    this.table(body.data, columns);
    this.logger.info(
      `page ${body.meta.currentPage} of ${body.meta.lastPage} · ${body.meta.total} total`,
    );
  }
}

/** Up to two text-ish columns that identify a document (title, name, slug, …). */
function titleColumns(docs: readonly Record<string, unknown>[]): string[] {
  const first = docs[0] ?? {};
  const preferred = ['title', 'name', 'slug', 'label', 'email'].filter((key) => key in first);
  return preferred.slice(0, 2);
}

export class CmsDocumentsShow extends ReadCommand {
  static override commandName = 'cms:documents:show';
  static override description = 'One document by id';

  @args.string({ description: 'Collection slug' })
  declare collection: string;

  @args.string({ description: 'Document id' })
  declare id: string;

  override async run() {
    const doc = (await this.rest({ write: false, slug: this.collection }, handleCollectionFindOne, {
      params: { slug: this.collection, id: this.id },
      query: this.readQuery(),
    })) as Record<string, unknown>;
    if (this.json) return this.printJson(doc);
    this.document(doc);
  }
}

/** Data flags shared by create and update. */
abstract class DataCommand extends CmsContentCommand {
  @flags.string({
    description: 'Field values: a JSON object, or @file.json',
    required: true,
  })
  declare data: string;

  @flags.boolean({ description: 'Keep it as a draft (create unpublished / edit as pending draft)' })
  declare draft?: boolean;

  protected done(doc: Record<string, unknown>, what: string): void {
    if (this.json) {
      this.printJson(doc);
      return;
    }
    this.logger.success(`${what} ${cell(doc.id)}${doc._status ? ` (${String(doc._status)})` : ''}`);
  }
}

export class CmsDocumentsCreate extends DataCommand {
  static override commandName = 'cms:documents:create';
  static override description = 'Create a document (access, hooks and validation apply)';

  @args.string({ description: 'Collection slug' })
  declare collection: string;

  override async run() {
    const data = await jsonObjectFlag(this.data, 'data');
    const doc = (await this.rest(
      { write: true, slug: this.collection, operation: 'create' },
      handleCollectionCreate,
      {
        params: { slug: this.collection },
        query: this.draft ? { draft: 'true' } : {},
        body: data,
      },
    )) as Record<string, unknown>;
    this.done(doc, 'created');
  }
}

export class CmsDocumentsUpdate extends DataCommand {
  static override commandName = 'cms:documents:update';
  static override description = 'Update fields of a document (unlisted fields are kept)';

  @args.string({ description: 'Collection slug' })
  declare collection: string;

  @args.string({ description: 'Document id' })
  declare id: string;

  override async run() {
    const data = await jsonObjectFlag(this.data, 'data');
    const doc = (await this.rest(
      { write: true, slug: this.collection, operation: 'update' },
      handleCollectionUpdate,
      {
        params: { slug: this.collection, id: this.id },
        query: this.draft ? { draft: 'true' } : {},
        body: data,
      },
    )) as Record<string, unknown>;
    this.done(doc, 'updated');
  }
}

/** A write on one document, `<collection> <id>`. */
abstract class DocumentActionCommand extends CmsContentCommand {
  @args.string({ description: 'Collection slug' })
  declare collection: string;

  @args.string({ description: 'Document id' })
  declare id: string;

  protected async act(
    handler: Parameters<CmsContentCommand['rest']>[1],
    what: string,
    request: { query?: Record<string, unknown>; body?: Record<string, unknown> } = {},
    operation: 'update' | 'delete' = 'update',
  ): Promise<void> {
    const out = await this.rest({ write: true, slug: this.collection, operation }, handler, {
      params: { slug: this.collection, id: this.id },
      query: request.query ?? {},
      body: request.body,
    });
    if (this.json) return this.printJson(out ?? { ok: true });
    this.logger.success(`${what} ${this.collection}/${this.id}`);
  }
}

export class CmsDocumentsDelete extends DocumentActionCommand {
  static override commandName = 'cms:documents:delete';
  static override description =
    'Delete a document (soft delete moves it to the trash; --permanent removes it). Asks unless --force';

  @flags.boolean({ description: 'Remove for good instead of trashing' })
  declare permanent?: boolean;

  @flags.boolean({ description: 'Do not ask for confirmation' })
  declare force?: boolean;

  override async run() {
    const question = `${this.permanent ? 'Permanently delete' : 'Delete'} ${this.collection}/${this.id}?`;
    if (!(await this.confirmed(this.force, question))) return;
    await this.act(
      handleCollectionDelete,
      this.permanent ? 'permanently deleted' : 'deleted',
      { query: this.permanent ? { force: 'true' } : {} },
      'delete',
    );
  }
}

export class CmsDocumentsRestore extends DocumentActionCommand {
  static override commandName = 'cms:documents:restore';
  static override description = 'Bring a soft-deleted document back from the trash';

  override async run() {
    await this.act(handleCollectionRestore, 'restored');
  }
}

export class CmsDocumentsPublish extends DocumentActionCommand {
  static override commandName = 'cms:documents:publish';
  static override description = "Publish a document's latest draft";

  override async run() {
    await this.act(handleCollectionPublish, 'published');
  }
}

export class CmsDocumentsUnpublish extends DocumentActionCommand {
  static override commandName = 'cms:documents:unpublish';
  static override description = 'Take a published document offline (back to draft)';

  override async run() {
    await this.act(handleCollectionUnpublish, 'unpublished');
  }
}

export class CmsDocumentsDiscardDraft extends DocumentActionCommand {
  static override commandName = 'cms:documents:discard-draft';
  static override description =
    'Drop the pending draft of a published document. Asks unless --force';

  @flags.boolean({ description: 'Do not ask for confirmation' })
  declare force?: boolean;

  override async run() {
    if (
      !(await this.confirmed(this.force, `Discard the draft of ${this.collection}/${this.id}?`))
    ) {
      return;
    }
    await this.act(handleCollectionDiscardDraft, 'discarded the draft of');
  }
}

export class CmsDocumentsSchedule extends DocumentActionCommand {
  static override commandName = 'cms:documents:schedule';
  static override description = 'Schedule a publish or unpublish at a date';

  @flags.string({ description: 'When (ISO-8601)', required: true })
  declare at: string;

  @flags.string({ description: 'publish (default) or unpublish' })
  declare action?: string;

  override async run() {
    if (this.action !== undefined && this.action !== 'publish' && this.action !== 'unpublish') {
      throw new CmsCliRefusal('--action must be publish or unpublish');
    }
    await this.act(handleCollectionSchedule, `scheduled ${this.action ?? 'publish'} of`, {
      body: { at: this.at, action: this.action ?? 'publish' },
    });
  }
}

export class CmsDocumentsUnschedule extends DocumentActionCommand {
  static override commandName = 'cms:documents:unschedule';
  static override description = "Cancel a document's scheduled publish or unpublish";

  override async run() {
    await this.act(handleCollectionUnschedule, 'cancelled the schedule of');
  }
}

export class CmsDocumentsScheduled extends CmsContentCommand {
  static override commandName = 'cms:documents:scheduled';
  static override description = "A document's scheduled publish or unpublish, if any";

  @args.string({ description: 'Collection slug' })
  declare collection: string;

  @args.string({ description: 'Document id' })
  declare id: string;

  override async run() {
    const body = (await this.rest(
      { write: false, slug: this.collection },
      handleCollectionScheduled,
      { params: { slug: this.collection, id: this.id } },
    )) as { schedule: Record<string, unknown> | null };
    if (this.json) return this.printJson(body);
    if (body.schedule === null) {
      this.logger.info('nothing scheduled');
      return;
    }
    this.document(body.schedule);
  }
}

export class CmsVersionsList extends CmsContentCommand {
  static override commandName = 'cms:versions:list';
  static override description = "A document's version history, newest first";

  @args.string({ description: 'Collection slug' })
  declare collection: string;

  @args.string({ description: 'Document id' })
  declare id: string;

  @flags.string({ description: 'Only versions of this locale' })
  declare locale?: string;

  @flags.number({ description: 'Page (1-based)' })
  declare page?: number;

  @flags.number({ description: 'Page size' })
  declare size?: number;

  override async run() {
    const body = (await this.rest(
      { write: false, slug: this.collection },
      handleCollectionVersions,
      {
        params: { slug: this.collection, id: this.id },
        query: {
          ...(this.locale ? { filter: { locale: this.locale } } : {}),
          ...(this.page !== undefined ? { page: String(this.page) } : {}),
          ...(this.size !== undefined ? { size: String(this.size) } : {}),
        },
      },
    )) as Page;
    if (this.json) return this.printJson(body);
    this.table(body.data, ['version', 'status', 'locale', 'userId', 'createdAt']);
    this.logger.info(
      `page ${body.meta.currentPage} of ${body.meta.lastPage} · ${body.meta.total} total`,
    );
  }
}

export class CmsVersionsShow extends CmsContentCommand {
  static override commandName = 'cms:versions:show';
  static override description = 'One version of a document (--snapshot adds its content)';

  @args.string({ description: 'Collection slug' })
  declare collection: string;

  @args.string({ description: 'Document id' })
  declare id: string;

  @args.string({ description: 'Version number' })
  declare version: string;

  @flags.boolean({ description: 'Include the full content (needs draft access)' })
  declare snapshot?: boolean;

  override async run() {
    const body = (await this.rest(
      { write: false, slug: this.collection },
      handleCollectionVersion,
      {
        params: { slug: this.collection, id: this.id, version: this.version },
        query: this.snapshot ? { snapshot: 'true' } : {},
      },
    )) as Record<string, unknown>;
    if (this.json) return this.printJson(body);
    this.document(body);
  }
}

export class CmsVersionsRestore extends CmsContentCommand {
  static override commandName = 'cms:versions:restore';
  static override description =
    "Replace a document's content with one of its versions (history is kept). Asks unless --force";

  @args.string({ description: 'Collection slug' })
  declare collection: string;

  @args.string({ description: 'Document id' })
  declare id: string;

  @args.string({ description: 'Version number' })
  declare version: string;

  @flags.boolean({ description: 'Do not ask for confirmation' })
  declare force?: boolean;

  override async run() {
    const question = `Replace ${this.collection}/${this.id} with version ${this.version}?`;
    if (!(await this.confirmed(this.force, question))) return;
    const doc = (await this.rest(
      { write: true, slug: this.collection, operation: 'update' },
      handleCollectionRestoreVersion,
      { params: { slug: this.collection, id: this.id, version: this.version } },
    )) as Record<string, unknown>;
    if (this.json) return this.printJson(doc);
    this.logger.success(`restored ${this.collection}/${this.id} to version ${this.version}`);
  }
}

export class CmsGlobalsShow extends ReadCommand {
  static override commandName = 'cms:globals:show';
  static override description = 'A global (single-row document)';

  @args.string({ description: 'Global slug' })
  declare slug: string;

  override async run() {
    const doc = (await this.rest({ write: false, slug: this.slug }, handleGlobalGet, {
      params: { slug: this.slug },
      query: this.readQuery(),
    })) as Record<string, unknown>;
    if (this.json) return this.printJson(doc);
    this.document(doc);
  }
}

export class CmsGlobalsUpdate extends CmsContentCommand {
  static override commandName = 'cms:globals:update';
  static override description = 'Update fields of a global (unlisted fields are kept)';

  @args.string({ description: 'Global slug' })
  declare slug: string;

  @flags.string({ description: 'Field values: a JSON object, or @file.json', required: true })
  declare data: string;

  override async run() {
    const data = await jsonObjectFlag(this.data, 'data');
    const doc = (await this.rest(
      { write: true, slug: this.slug, operation: 'update' },
      handleGlobalUpdate,
      { params: { slug: this.slug }, body: data },
    )) as Record<string, unknown>;
    if (this.json) return this.printJson(doc);
    this.logger.success(`updated global ${this.slug}`);
  }
}

/** Every content command, for the commands barrel and its tests. */
export const contentCommands = [
  CmsCollectionsList,
  CmsCollectionsShow,
  CmsDocumentsList,
  CmsDocumentsShow,
  CmsDocumentsCreate,
  CmsDocumentsUpdate,
  CmsDocumentsDelete,
  CmsDocumentsRestore,
  CmsDocumentsPublish,
  CmsDocumentsUnpublish,
  CmsDocumentsDiscardDraft,
  CmsDocumentsSchedule,
  CmsDocumentsUnschedule,
  CmsDocumentsScheduled,
  CmsVersionsList,
  CmsVersionsShow,
  CmsVersionsRestore,
  CmsGlobalsShow,
  CmsGlobalsUpdate,
];
