import type { World } from './game/world.ts';

/** The one 3D world, shared by the landing page and the race. */
let instance: World | null = null;

export const world = () => instance;

export function setWorld(w: World | null) {
  instance = w;
}
