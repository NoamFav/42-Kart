import { world } from './stage.ts';
import { getState, setState, toast } from './store.ts';

const DURATION = 16_000;

let frame = 0;

/** Plays the whole season back in a few seconds, from the drone. */
export function startReplay() {
  const { history, players } = getState();
  const w = world();
  if (!w) return;
  if (history.length < 2) {
    toast('Nothing to replay yet. Go validate something.');
    return;
  }
  const start = history[0].ts;
  const end = Date.now();
  const series = new Map<string, { ts: number; km: number }[]>();
  for (const point of history) {
    let list = series.get(point.player);
    if (!list) series.set(point.player, (list = []));
    list.push(point);
  }

  const previousMode = w.mode;
  w.setMode('drone');
  const began = performance.now();

  const tick = (now: number) => {
    const t = Math.min(1, (now - began) / DURATION);
    const ts = start + (end - start) * t;
    const km: Record<string, number> = {};
    for (const p of players) {
      const list = series.get(p.id) ?? [];
      let value = 0;
      for (const point of list) {
        if (point.ts > ts) break;
        value = point.km;
      }
      km[p.id] = value;
    }
    w.replayKm = new Map(Object.entries(km));
    setState({ replay: { t: ts, km } });
    if (t < 1) frame = requestAnimationFrame(tick);
    else window.setTimeout(() => stopReplay(previousMode === 'drive' ? 'tour' : previousMode), 900);
  };
  frame = requestAnimationFrame(tick);
}

export function stopReplay(mode: 'tour' | 'drone' | 'follow' = 'tour') {
  cancelAnimationFrame(frame);
  const w = world();
  if (w) {
    w.replayKm = null;
    const { players, effects, meId } = getState();
    w.setRoster(players, effects, meId);
    w.setMode(mode);
  }
  setState({ replay: null });
}
