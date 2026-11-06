import { useSyncExternalStore } from 'react';
import type {
  ClientMsg, Effect, ItemId, KmPoint, LapTime, PlayerPublic, RaceEvent, RoomInfo, ServerMsg,
} from '../../shared/protocol.ts';
import { sfx } from './audio.ts';
import { world } from './stage.ts';

export interface Banner {
  key: number;
  event: RaceEvent;
}

export interface Replay {
  t: number;
  km: Record<string, number>;
}

export interface State {
  status: 'idle' | 'connecting' | 'open' | 'lost' | 'missing';
  room: RoomInfo | null;
  players: PlayerPublic[];
  events: RaceEvent[];
  effects: Effect[];
  times: LapTime[];
  history: KmPoint[];
  meId: string | null;
  items: ItemId[];
  gained: { item: ItemId; key: number } | null;
  /** When this player last visited, read once at connect time. */
  awaySince: number | null;
  banners: Banner[];
  toast: { text: string; key: number } | null;
  replay: Replay | null;
  /** Difference between the server clock and this one. */
  clockSkew: number;
}

const initial: State = {
  status: 'idle', room: null, players: [], events: [], effects: [], times: [], history: [],
  meId: null, items: [], gained: null, awaySince: null, banners: [], toast: null, replay: null, clockSkew: 0,
};

let state = initial;
const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
  );
}

/* ---- Standings ---- */

export function rankPlayers(players: PlayerPublic[], km?: Record<string, number>): PlayerPublic[] {
  const of = (p: PlayerPublic) => km?.[p.id] ?? p.km;
  return [...players].sort((a, b) => of(b) - of(a) || b.bonus - a.bonus || a.joinedAt - b.joinedAt);
}

export const playerById = (id?: string) => state.players.find((p) => p.id === id);

/* ---- Session ---- */

const tokenKey = (room: string) => `kart:token:${room}`;

export function loadToken(room: string): string | null {
  try {
    return localStorage.getItem(tokenKey(room));
  } catch {
    return null;
  }
}

function saveToken(room: string, token: string | null) {
  try {
    if (token) localStorage.setItem(tokenKey(room), token);
    else localStorage.removeItem(tokenKey(room));
  } catch {
    // Without storage the session lasts until the tab closes.
  }
}

/* ---- Socket ---- */

let socket: WebSocket | null = null;
let currentRoom: string | null = null;
let retry = 0;
let retryTimer = 0;
let sessionToken: string | null = null;
let bannerKey = 1;

export function send(msg: ClientMsg) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function pushWorld() {
  world()?.setRoster(state.players, state.effects, state.meId);
}

const BANNER_TYPES = new Set(['validate', 'fail', 'overtake', 'module', 'finish', 'item', 'blocked']);

function handle(msg: ServerMsg) {
  switch (msg.t) {
    case 'snapshot': {
      const first = state.status !== 'open' && !state.room;
      setState({
        status: 'open',
        room: msg.room,
        players: msg.players,
        events: msg.events,
        effects: msg.effects,
        times: msg.times,
        history: msg.history,
        meId: msg.me?.id ?? null,
        items: msg.me?.items ?? [],
        awaySince: first && msg.me ? msg.me.lastSeen : state.awaySince,
        clockSkew: msg.now - Date.now(),
      });
      pushWorld();
      break;
    }
    case 'player': {
      const exists = state.players.some((p) => p.id === msg.player.id);
      setState({
        players: exists ? state.players.map((p) => (p.id === msg.player.id ? msg.player : p)) : [...state.players, msg.player],
      });
      pushWorld();
      break;
    }
    case 'event': {
      const events = [...state.events, msg.event].slice(-200);
      const notable = BANNER_TYPES.has(msg.event.type);
      setState({
        events,
        banners: notable ? [...state.banners, { key: bannerKey++, event: msg.event }].slice(-6) : state.banners,
      });
      // The player update that moves the kart lands right after the event.
      window.setTimeout(() => world()?.raceEvent(msg.event), 70);
      if (msg.event.type === 'shout' && msg.event.text) world()?.say(msg.event.player, msg.event.text);
      break;
    }
    case 'react':
      setState({ events: state.events.map((e) => (e.id === msg.ev ? { ...e, reactions: msg.reactions } : e)) });
      break;
    case 'presence': {
      const online = new Set(msg.online);
      setState({ players: state.players.map((p) => ({ ...p, online: online.has(p.id) })) });
      pushWorld();
      break;
    }
    case 'live':
      world()?.live(msg.karts);
      break;
    case 'liveEnd':
      world()?.liveEnd(msg.id);
      break;
    case 'honk':
      world()?.honk(msg.id);
      sfx.honk();
      break;
    case 'me':
      setState({ items: msg.items, gained: msg.gained ? { item: msg.gained, key: Date.now() } : state.gained });
      break;
    case 'effects':
      setState({ effects: msg.effects });
      pushWorld();
      break;
    case 'times':
      setState({ times: msg.times });
      break;
    case 'room':
      setState({ room: msg.room });
      break;
    case 'km':
      setState({ history: [...state.history, msg.point] });
      break;
    case 'error':
      if (msg.message === 'This race does not exist.') setState({ status: 'missing' });
      else toast(msg.message);
      break;
  }
}

export function toast(text: string) {
  setState({ toast: { text, key: Date.now() } });
}

function open() {
  if (!currentRoom) return;
  const room = currentRoom;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  socket = ws;
  ws.onopen = () => {
    retry = 0;
    ws.send(JSON.stringify({ t: 'hello', room, token: sessionToken ?? undefined } satisfies ClientMsg));
  };
  ws.onmessage = (e) => handle(JSON.parse(String(e.data)) as ServerMsg);
  ws.onclose = () => {
    if (socket !== ws || !currentRoom) return;
    if (state.status !== 'missing') setState({ status: 'lost' });
    retryTimer = window.setTimeout(open, Math.min(8000, 500 * 2 ** retry++));
  };
}

export function connect(room: string) {
  disconnect();
  currentRoom = room;
  sessionToken = loadToken(room);
  setState({ ...initial, status: 'connecting' });
  open();
}

export function disconnect() {
  currentRoom = null;
  window.clearTimeout(retryTimer);
  const ws = socket;
  socket = null;
  ws?.close();
}

function reconnectAs(room: string, token: string | null) {
  saveToken(room, token);
  sessionToken = token;
  const ws = socket;
  socket = null;
  ws?.close();
  open();
}

export const signOut = () => {
  if (currentRoom) reconnectAs(currentRoom, null);
  setState({ meId: null, items: [] });
  pushWorld();
};

/* ---- HTTP ---- */

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong.');
  return data;
}

export const createRoom = (name: string) => post<RoomInfo>('/api/rooms', { name });

export async function joinRace(room: string, body: Record<string, unknown>) {
  const { token } = await post<{ token: string }>(`/api/rooms/${room}/join`, body);
  reconnectAs(room, token);
}

export async function reclaimKart(room: string, login: string, pin: string) {
  const { token } = await post<{ token: string }>(`/api/rooms/${room}/reclaim`, { login, pin });
  reconnectAs(room, token);
}
