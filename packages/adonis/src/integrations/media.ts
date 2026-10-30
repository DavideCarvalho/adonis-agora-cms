import type { CmsUpload } from '../types/document.js';

export type MediaAsset = {
  id: string;
  url: string;
  mime?: string;
  width?: number;
  height?: number;
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
          },
        ]),
      );
    },
  };
}

/**
 * Adapts the common shape of `@adonis-agora/media` (`MediaLibrary.find`) without importing it,
 * so the CMS does not depend on the media package at runtime.
 */
export function mediaLibraryAdapter(library: {
  findMany?(ids: readonly string[]): Promise<readonly MediaAsset[]>;
  find?(id: string): Promise<MediaAsset | null>;
}): MediaAdapter {
  return createMediaAdapter(async (ids) => {
    if (library.findMany) return library.findMany(ids);
    if (!library.find) return [];

    const found = await Promise.all(ids.map((id) => library.find?.(id)));
    return found.filter((asset): asset is MediaAsset => Boolean(asset));
  });
}
