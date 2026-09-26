import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { DemoBar, startDemo } from './demo/DemoBar';
import { App } from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, err) => n < 2 && !('status' in err && (err as { status: number }).status < 500), staleTime: 5_000 },
  },
});

if (import.meta.env.VITE_DEMO) startDemo(queryClient);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {import.meta.env.VITE_DEMO ? (
        <MemoryRouter>
          <DemoBar />
          <App />
        </MemoryRouter>
      ) : (
        <BrowserRouter>
          <App />
        </BrowserRouter>
      )}
    </QueryClientProvider>
  </StrictMode>,
);
