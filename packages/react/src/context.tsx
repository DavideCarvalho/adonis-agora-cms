import { createContext, type ReactNode, useContext } from 'react';
import type { AdminClient } from './client.js';
import { type CmsLocale, type CmsMessages, cmsMessages } from './i18n.js';
import type { CmsUpload } from './types.js';

/**
 * Uploads one dropped file. The admin app passes the REST uploader; a custom dashboard can pass
 * anything (S3 presign, media library, tests) — the dropzone only needs the returned asset.
 */
export type CmsUploader = (
  file: File,
  options: { field?: string; collection?: string },
) => Promise<CmsUpload>;

type CmsContextValue = {
  client: AdminClient;
  locale: CmsLocale;
  t: CmsMessages;
  upload?: CmsUploader | undefined;
};

const CmsContext = createContext<CmsContextValue | null>(null);

export function CmsProvider({
  client,
  locale = 'en',
  upload,
  children,
}: {
  client: AdminClient;
  /** Admin UI language. Content localization lives in the CMS config, not here. */
  locale?: CmsLocale;
  /** Enables the dropzone on `upload` fields. Omit to keep the field as a relation picker. */
  upload?: CmsUploader;
  children: ReactNode;
}) {
  return (
    <CmsContext.Provider value={{ client, locale, t: cmsMessages[locale], upload }}>
      {children}
    </CmsContext.Provider>
  );
}

export function useCms(): CmsContextValue {
  const value = useContext(CmsContext);
  if (!value) throw new Error('useCms must be used inside <CmsProvider>');
  return value;
}

/** UI strings for the active admin locale. */
export function useMessages(): CmsMessages {
  return useCms().t;
}
