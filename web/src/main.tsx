import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/500.css';
import '@fontsource/public-sans/600.css';
import '@fontsource/fira-code/400.css';
import { App } from './App';
import { ConfirmProvider } from './lib/confirm';
import { LiveProvider } from './lib/live';
import { RangeProvider } from './lib/range';
import { ToastProvider } from './lib/toast';
import './styles.css';

const client = new QueryClient({ defaultOptions: { queries: { staleTime: 2000, retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <LiveProvider>
        <RangeProvider>
        <ToastProvider>
          <ConfirmProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ConfirmProvider>
        </ToastProvider>
        </RangeProvider>
      </LiveProvider>
    </QueryClientProvider>
  </StrictMode>,
);
