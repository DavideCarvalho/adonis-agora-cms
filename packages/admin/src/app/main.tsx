import { AdminClient, CmsProvider } from '@adonis-agora/cms-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

const client = new AdminClient();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <CmsProvider client={client}>
          <App />
        </CmsProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}
