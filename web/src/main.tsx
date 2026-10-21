import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation } from './lib/router';
import { installProjectHistory } from './lib/project';
import { ProjectGate } from './lib/projects';
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

installProjectHistory();
function ProjectState() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 2000, retry: 1, refetchOnWindowFocus: false } } }));
  return <QueryClientProvider client={client}><LiveProvider><RangeProvider><ToastProvider><ConfirmProvider><ProjectGate><App /></ProjectGate></ConfirmProvider></ToastProvider></RangeProvider></LiveProvider></QueryClientProvider>;
}
function ProjectRoot() {
  const location = useLocation();
  const project = new URLSearchParams(location.search).get('project') || 'default';
  return <ProjectState key={project} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><ProjectRoot /></BrowserRouter></StrictMode>);
