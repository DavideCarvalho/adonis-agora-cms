import type { CmsUploadHandler } from '../config/types.js';
import type { CmsUpload } from '../types/document.js';

export type MediaAsset = {
  id: string;
  url: string;
  mime?: string;
  width?: number;
  height?: number;
  /** Generated sizes by name, each with its URL. */
  sizes?: Record<string, string>;
};

/**
 * Bridge to `@adonis-agora/media`.
 *
 * The CMS never stores files: `upload` fields hold an id, and this adapter resolves them into
 * `{ id, url, mime, width, height }` on read. Without an adapter the id is returned as-is.
 */
export type MediaAdapter = {
  resolveMany(ids: readonly string[]): Promise<Map<string, CmsUpload>>;
};

export function createMediaAdapter(
  resolver: (ids: readonly string[]) => Promise<readonly MediaAsset[]>,
): MediaAdapter {
  return {
    async resolveMany(ids) {
      const unique = [...new Set(ids)].filter(Boolean);
      if (unique.length === 0) return new Map();
      const assets = await resolver(unique);

      return new Map(
        assets.map((asset) => [
          asset.id,
          {
            id: asset.id,
            url: asset.url,
            ...(asset.mime !== undefined ? { mime: asset.mime } : {}),
            ...(asset.width !== undefined ? { width: asset.width } : {}),
            ...(asset.height !== undefined ? { height: asset.height } : {}),
            ...(asset.sizes ? { sizes: asset.sizes } : {}),
          },
        ]),
      );
    },
  };
}

type MediaRecordLike = {
  id: string;
  fileName?: string;
  mimeType?: string;
  /** Older or custom libraries hand these over directly. */
  url?: string;
  mime?: string;
  width?: number;
  height?: number;
  /** Generated variants by conversion name. */
  conversions?: Record<string, unknown>;
};

export type ReadLibrary = {
  find(id: string): Promise<MediaRecordLike | null>;
  url?(id: string, conversion?: string): Promise<string>;
};

/** `@adonis-agora/media` on read. Its records carry no URL, so each one comes from `library.url(id)`. */
export function mediaLibraryAdapter(
  source: () => ReadLibrary | Promise<ReadLibrary>,
): MediaAdapter {
  return createMediaAdapter(async (ids) => {
    const library = await source();
    const found = await Promise.all(
      ids.map(async (id): Promise<MediaAsset | null> => {
        const record = await library.find(id);
        if (!record) return null;
        const url = record.url ?? (await library.url?.(id));
        if (!url) return null;
        const mime = record.mimeType ?? record.mime;
        // Already generated ones only: asking for a URL would generate the rest on a read.
        const names = Object.keys(record.conversions ?? {});
        const sizes = library.url
          ? Object.fromEntries(
              await Promise.all(
                names.map(async (name) => [name, await library.url?.(id, name)] as const),
              ),
            )
          : {};
        return {
          id: record.id,
          url,
          ...(mime !== undefined ? { mime } : {}),
          ...(record.width !== undefined ? { width: record.width } : {}),
          ...(record.height !== undefined ? { height: record.height } : {}),
          ...(Object.keys(sizes).length > 0 ? { sizes: sizes as Record<string, string> } : {}),
        };
      }),
    );
    return found.filter((asset): asset is MediaAsset => asset !== null);
  });
}

/** `@adonis-agora/media` for `uploads.handler`. `collection` is one of the library's media collections. */
export function mediaLibraryUploads(
  source: () => MediaUploadLibrary | Promise<MediaUploadLibrary>,
  options: { ownerType?: string; ownerId?: string; collection?: string } = {},
): CmsUploadHandler {
  return async (file, context) => {
    const target = await source();
    const record = await target.attach({
      ownerType: options.ownerType ?? 'cms',
      ownerId: options.ownerId ?? 'cms',
      collection: options.collection ?? (context.field || 'default'),
      fileName: file.filename,
      mimeType: file.mimeType,
      contents: Buffer.from(file.contents),
      size: file.size,
    });
    return {
      id: record.id,
      filename: record.fileName ?? file.filename,
      url: await target.url(record.id),
      mime: record.mimeType ?? file.mimeType,
    };
  };
}

export type MediaUploadLibrary = {
  attach(input: {
    ownerType: string;
    ownerId: string;
    collection: string;
    fileName: string;
    mimeType: string;
    contents: Buffer;
    size: number;
  }): Promise<MediaRecordLike>;
  url(id: string): Promise<string>;
};
