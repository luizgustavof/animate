import { createBrowserRouter } from 'react-router';
import type { ComponentType } from 'react';
import { Root } from './Root';
import { isStaleChunkError, reloadForNewBuild } from './stale-build';

// a chunk from an older build → reload into the new one instead of showing the router's error screen
function screen(load: () => Promise<ComponentType>) {
  return async () => {
    try {
      return { Component: await load() };
    } catch (e) {
      if (isStaleChunkError(e) && reloadForNewBuild()) return new Promise<never>(() => {});   // page is reloading
      throw e;
    }
  };
}

// one screen per route, each its own chunk
export const router = createBrowserRouter([
  {
    path: '/',
    Component: Root,
    HydrateFallback: () => null,   // the first lazy screen loads in a few ms; nothing to flash meanwhile
    children: [
      { index: true, lazy: screen(async () => (await import('../screens/Board')).Board) },
      { path: 'ep/:slug', lazy: screen(async () => (await import('../screens/Episode')).Episode) },
      { path: 'canais', lazy: screen(async () => (await import('../screens/Channels')).Channels) },
      { path: 'desempenho', lazy: screen(async () => (await import('../screens/Performance')).Performance) },
      { path: '*', lazy: screen(async () => (await import('../screens/Board')).Board) },
    ],
  },
]);
