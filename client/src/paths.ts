/**
 * Where the client lives and where the backend lives. Served by the Node server, both are
 * the same origin at the root. On GitHub Pages the client sits under /42-Kart/ and the
 * backend stays on Fly, set at build time through VITE_BASE and VITE_API_ORIGIN.
 */

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export const API_ORIGIN: string = import.meta.env.VITE_API_ORIGIN ?? '';

/** Browser path to the app's own route: /42-Kart/r/x becomes /r/x. */
export const toRoute = (pathname: string) =>
  pathname.startsWith(BASE) ? pathname.slice(BASE.length) || '/' : pathname;

export const toUrl = (route: string) => BASE + route;

export function socketUrl() {
  const origin = API_ORIGIN || location.origin;
  return `${origin.replace(/^http/, 'ws')}/ws`;
}
