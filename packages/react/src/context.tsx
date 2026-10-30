import { createContext, type ReactNode, useContext } from 'react';
import type { AdminClient } from './client.js';
import { type CmsLocale, type CmsMessages, cmsMessages } from './i18n.js';

type CmsContextValue = { client: AdminClient; locale: CmsLocale; t: CmsMessages };

const CmsContext = createContext<CmsContextValue | null>(null);

export function CmsProvider({
  client,
  locale = 'en',
  children,
}: {
  client: AdminClient;
  /** Admin UI language. Content localization lives in the CMS config, not here. */
  locale?: CmsLocale;
  children: ReactNode;
}) {
  return (
    <CmsContext.Provider value={{ client, locale, t: cmsMessages[locale] }}>
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
