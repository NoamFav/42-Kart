import type { Progress } from './curriculum.ts';

/* ---- Karts ---- */

export const BODIES = [
  { id: 'classic', name: 'Cluster Classic', note: 'Open wheels. Honest work.' },
  { id: 'wedge', name: 'Null Pointer', note: 'Low, sharp, dereferences corners.' },
  { id: 'rover', name: 'Big Endian', note: 'Heavy at the wrong end.' },
  { id: 'hover', name: 'Daemon', note: 'Runs in the background. No wheels.' },
  { id: 'chair', name: 'Office Chair', note: 'Stolen from the cluster. Rocket added.' },
] as const;

export const DRIVERS = [
  { id: 'cadet', name: 'Cadet' },
  { id: 'duck', name: 'Rubber Duck' },
  { id: 'bot', name: 'Moulinette Jr.' },
  { id: 'cat', name: 'Peer Cat' },
  { id: 'penguin', name: 'Sudo Penguin' },
  { id: 'bug', name: 'The Bug' },
] as const;

export const PAINTS = [
  '#ff3b4e', '#ff8a1f', '#ffd21f', '#35d07f', '#00babc',
  '#2f7bff', '#8a5cff', '#ff4fa3', '#f2f4f8', '#20242e',
] as const;

export type BodyId = (typeof BODIES)[number]['id'];
export type DriverId = (typeof DRIVERS)[number]['id'];

export interface KartConfig {
  body: BodyId;
  driver: DriverId;
  paint: string;
  accent: string;
  number: number;
}

export const DEFAULT_KART: KartConfig = {
  body: 'classic',
  driver: 'cadet',
  paint: '#00babc',
  accent: '#f2f4f8',
  number: 42,
};

/* ---- Items: purely cosmetic. They never change anyone's distance. ---- */

export type ItemId = 'coffee' | 'norminette' | 'segfault' | 'leak' | 'moulinette' | 'duck';

export interface ItemDef {
  id: ItemId;
  name: string;
  glyph: string;
  /** self: your kart. ahead: the kart right in front. leader: P1. */
  target: 'self' | 'ahead' | 'leader';
  /** How long the effect sits on the kart. */
  hours: number;
  text: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  coffee: { id: 'coffee', name: 'Triple Espresso', glyph: '☕', target: 'self', hours: 6, text: 'Nitro flames for six hours.' },
  norminette: { id: 'norminette', name: 'Norminette', glyph: '📏', target: 'ahead', hours: 12, text: 'Tags the kart ahead with Norm: KO.' },
  segfault: { id: 'segfault', name: 'Segfault', glyph: '💥', target: 'ahead', hours: 6, text: 'Spins out the kart ahead, core dumped.' },
  leak: { id: 'leak', name: 'Memory Leak', glyph: '💧', target: 'ahead', hours: 12, text: 'The kart ahead drips bytes everywhere.' },
  moulinette: { id: 'moulinette', name: 'Moulinette', glyph: '⚡', target: 'leader', hours: 6, text: 'Strikes the leader. Their kart shrinks.' },
  duck: { id: 'duck', name: 'Rubber Duck', glyph: '🦆', target: 'self', hours: 48, text: 'Shields you from the next attack.' },
};

export const MAX_ITEMS = 3;

export interface Effect {
  id: number;
  target: string;
  by: string;
  item: ItemId;
  until: number;
}

/* ---- Room state ---- */

export interface PlayerPublic {
  id: string;
  login: string;
  name: string;
  kart: KartConfig;
  joinedAt: number;
  lastSeen: number;
  online: boolean;
  km: number;
  bonus: number;
  progress: Progress;
  itemCount: number;
}

export type EventType =
  | 'join' | 'start' | 'validate' | 'fail' | 'overtake'
  | 'module' | 'finish' | 'item' | 'blocked' | 'shout';

export interface RaceEvent {
  id: number;
  ts: number;
  player: string;
  type: EventType;
  /** Project id, for start / validate / fail. */
  project?: string;
  grade?: number;
  /** Other player involved: the overtaken one, the item's target. */
  other?: string;
  item?: ItemId;
  module?: string;
  text?: string;
  km?: number;
  reactions?: Record<string, string[]>;
}

export interface RoomInfo {
  code: string;
  name: string;
  createdAt: number;
  paceStart: number;
  paceEnd: number;
  exam: NextExam | null;
}

export interface NextExam {
  name: string;
  at: number;
  place: string;
}

export interface LapTime {
  player: string;
  sector: number;
  ms: number;
}

export interface KmPoint {
  player: string;
  ts: number;
  km: number;
}

export interface Snapshot {
  room: RoomInfo;
  players: PlayerPublic[];
  events: RaceEvent[];
  effects: Effect[];
  times: LapTime[];
  history: KmPoint[];
  now: number;
}

/* ---- Wire messages ---- */

export type ProjectAction = 'none' | 'wip' | 'done' | 'fail';

export type ClientMsg =
  | { t: 'hello'; room: string; token?: string }
  | { t: 'project'; id: string; action: ProjectAction; pct?: number; grade?: number }
  | { t: 'item' }
  | { t: 'honk' }
  | { t: 'react'; ev: number; emoji: string }
  | { t: 'shout'; text: string }
  | { t: 'kart'; kart: KartConfig; name?: string }
  | { t: 'exam'; exam: NextExam | null }
  | { t: 'pace'; end: number }
  /** Live driving: track distance, lateral offset, heading offset, speed, drifting. */
  | { t: 'live'; s: number; l: number; h: number; v: number; d: number }
  | { t: 'liveEnd' }
  | { t: 'time'; sector: number; ms: number };

export type LivePacket = [id: string, s: number, l: number, h: number, v: number, d: number];

export type ServerMsg =
  | ({ t: 'snapshot'; me: { id: string; items: ItemId[]; lastSeen: number } | null } & Snapshot)
  | { t: 'player'; player: PlayerPublic }
  | { t: 'event'; event: RaceEvent }
  | { t: 'react'; ev: number; reactions: Record<string, string[]> }
  | { t: 'presence'; online: string[] }
  | { t: 'live'; karts: LivePacket[] }
  | { t: 'liveEnd'; id: string }
  | { t: 'honk'; id: string }
  | { t: 'me'; items: ItemId[]; gained?: ItemId }
  | { t: 'effects'; effects: Effect[] }
  | { t: 'times'; times: LapTime[] }
  | { t: 'room'; room: RoomInfo }
  | { t: 'km'; point: KmPoint }
  | { t: 'error'; message: string };

export const REACTIONS = ['🔥', '👏', '💀', '🤨'] as const;

export const LOGIN_RE = /^[a-z0-9][a-z0-9_-]{1,15}$/;
export const PIN_RE = /^\d{4,8}$/;
export const MAX_PLAYERS = 42;
export const PACE_DEFAULT_MONTHS = 24;

export function sanitizeKart(input: unknown): KartConfig | null {
  if (!input || typeof input !== 'object') return null;
  const k = input as Record<string, unknown>;
  const body = BODIES.find((b) => b.id === k.body)?.id;
  const driver = DRIVERS.find((d) => d.id === k.driver)?.id;
  const color = /^#[0-9a-f]{6}$/i;
  if (!body || !driver) return null;
  if (typeof k.paint !== 'string' || !color.test(k.paint)) return null;
  if (typeof k.accent !== 'string' || !color.test(k.accent)) return null;
  const number = Number(k.number);
  if (!Number.isInteger(number) || number < 0 || number > 99) return null;
  return { body, driver, paint: k.paint, accent: k.accent, number };
}
