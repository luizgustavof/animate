import { createBrowserRouter } from 'react-router';
import { Root } from './Root';

// one screen per route, each its own chunk
export const router = createBrowserRouter([
  {
    path: '/',
    Component: Root,
    HydrateFallback: () => null,   // the first lazy screen loads in a few ms; nothing to flash meanwhile
    children: [
      { index: true, lazy: async () => ({ Component: (await import('../screens/Board')).Board }) },
      { path: 'ep/:slug', lazy: async () => ({ Component: (await import('../screens/Episode')).Episode }) },
      { path: 'canais', lazy: async () => ({ Component: (await import('../screens/Channels')).Channels }) },
      { path: 'desempenho', lazy: async () => ({ Component: (await import('../screens/Performance')).Performance }) },
      { path: '*', lazy: async () => ({ Component: (await import('../screens/Board')).Board }) },
    ],
  },
]);
