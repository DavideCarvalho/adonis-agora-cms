import { createContext, type ReactNode, useContext } from 'react';
import type { AdminClient } from './client.js';

type CmsContextValue = { client: AdminClient };

const CmsContext = createContext<CmsContextValue | null>(null);

export function CmsProvider({ client, children }: { client: AdminClient; children: ReactNode }) {
  return <CmsContext.Provider value={{ client }}>{children}</CmsContext.Provider>;
}

export function useCms(): CmsContextValue {
  const value = useContext(CmsContext);
  if (!value) throw new Error('useCms must be used inside <CmsProvider>');
  return value;
}
