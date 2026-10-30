import { AdminClient, CmsProvider } from '@adonis-agora/cms-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

const adminLocale = import.meta.env.VITE_CMS_LOCALE === 'pt-BR' ? 'pt-BR' : 'en';
const client = new AdminClient();

// Drops on `upload` fields go through `POST /api/cms/uploads`; the app must configure
// `cms.uploads.handler` for the endpoint to exist.
const upload = (file: File, options: { field?: string; collection?: string }) =>
  client.upload(file, options);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <CmsProvider client={client} locale={adminLocale} upload={upload}>
          <App />
        </CmsProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
