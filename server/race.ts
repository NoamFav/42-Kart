import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  MAX_GRADE, MAX_WIP_PCT, MODULES, PROJECT_BY_ID, TOTAL_KM,
  bonusOf, distanceOf, isModuleDone,
} from '../shared/curriculum.ts';
import type { Progress, ProjectState } from '../shared/curriculum.ts';
import {
  ITEMS, LOGIN_RE, MAX_ITEMS, MAX_PLAYERS, PACE_DEFAULT_MONTHS, PIN_RE, REACTIONS, sanitizeKart,
} from '../shared/protocol.ts';
import type {
  Effect, EventType, ItemId, KartConfig, KmPoint, LapTime, NextExam, PlayerPublic,
  ProjectAction, RaceEvent, RoomInfo, ServerMsg, Snapshot,
} from '../shared/protocol.ts';

export class GameError extends Error {}

interface PlayerRow {
  id: string;
  room: string;
  login: string;
  name: string;
  kart: string;
  pin_hash: string;
  token_hash: string;
  joined_at: number;
  last_seen: number;
  items: string;
  item_refill_at: number;
}

interface Hooks {
  /** Send to everyone in the room. */
  broadcast(room: string, msg: ServerMsg): void;
  /** Send to one player's open sockets. */
  whisper(playerId: string, msg: ServerMsg): void;
  isOnline(playerId: string): boolean;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

const ADJECTIVES = ['dangling', 'leaky', 'static', 'volatile', 'recursive', 'forked', 'unsigned', 'async', 'greedy', 'lazy', 'atomic', 'null'];
const NOUNS = ['pointer', 'stack', 'mutex', 'daemon', 'socket', 'cursor', 'buffer', 'thread', 'kernel', 'bracket', 'cadet', 'heap'];

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function hashPin(pin: string, room: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(`${room}:${pin}`, salt, 32);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

function checkPin(pin: string, room: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  const candidate = scryptSync(`${room}:${pin}`, Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(candidate, Buffer.from(key, 'hex'));
}

const cleanText = (value: unknown, max: number) =>
  typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';

const newId = () => randomBytes(6).toString('base64url');

export class Race {
  private db: DatabaseSync;
  private hooks: Hooks;
  private pinFailures = new Map<string, { count: number; until: number }>();

  constructor(db: DatabaseSync, hooks: Hooks) {
    this.db = db;
    this.hooks = hooks;
  }

  /* ---- Rooms ---- */

  createRoom(rawName: unknown, now = Date.now()): RoomInfo {
    const name = cleanText(rawName, 40) || 'Common Core Grand Prix';
    let code = '';
    do {
      const pick = (list: string[]) => list[randomInt(list.length)];
      code = `${pick(ADJECTIVES)}-${pick(NOUNS)}-${randomInt(10, 100)}`;
    } while (this.db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(code));

    const paceEnd = new Date(now);
    paceEnd.setMonth(paceEnd.getMonth() + PACE_DEFAULT_MONTHS);
    const firstExam: NextExam = {
      name: 'Exam: Programming Fundamentals',
      at: Date.parse('2026-11-12T16:00:00+01:00'),
      place: 'F2',
    };
    this.db
      .prepare('INSERT INTO rooms (code, name, created_at, pace_start, pace_end, exam) VALUES (?, ?, ?, ?, ?, ?)')
      .run(code, name, now, now, paceEnd.getTime(), firstExam.at > now ? JSON.stringify(firstExam) : null);
    return this.roomInfo(code)!;
  }

  roomInfo(code: string): RoomInfo | null {
    const r = this.db.prepare('SELECT * FROM rooms WHERE code = ?').get(code) as
      | { code: string; name: string; created_at: number; pace_start: number; pace_end: number; exam: string | null }
      | undefined;
    if (!r) return null;
    return {
      code: r.code,
      name: r.name,
      createdAt: r.created_at,
      paceStart: r.pace_start,
      paceEnd: r.pace_end,
      exam: r.exam ? JSON.parse(r.exam) : null,
    };
  }

  /* ---- Reading state ---- */

  private rowById(id: string): PlayerRow | undefined {
    return this.db.prepare('SELECT * FROM players WHERE id = ?').get(id) as PlayerRow | undefined;
  }

  private progressOf(id: string): Progress {
    const rows = this.db.prepare('SELECT project, state FROM progress WHERE player = ?').all(id) as {
      project: string;
      state: string;
    }[];
    return Object.fromEntries(rows.map((r) => [r.project, JSON.parse(r.state) as ProjectState]));
  }

  private toPublic(row: PlayerRow): PlayerPublic {
    const progress = this.progressOf(row.id);
    return {
      id: row.id,
      login: row.login,
      name: row.name,
      kart: JSON.parse(row.kart) as KartConfig,
      joinedAt: row.joined_at,
      lastSeen: row.last_seen,
      online: this.hooks.isOnline(row.id),
      km: distanceOf(progress),
      bonus: bonusOf(progress),
      progress,
      itemCount: (JSON.parse(row.items) as ItemId[]).length,
    };
  }

  players(room: string): PlayerPublic[] {
    const rows = this.db.prepare('SELECT * FROM players WHERE room = ?').all(room) as unknown as PlayerRow[];
    return rows.map((r) => this.toPublic(r));
  }

  /** Race order: distance, then bonus points, then whoever joined first. */
  standings(room: string): PlayerPublic[] {
    return this.players(room).sort((a, b) => b.km - a.km || b.bonus - a.bonus || a.joinedAt - b.joinedAt);
  }

  private eventsOf(room: string, limit = 150): RaceEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE room = ? ORDER BY id DESC LIMIT ?')
      .all(room, limit) as { id: number; ts: number; player: string; type: EventType; data: string }[];
    const events = rows.reverse().map((r) => ({
      id: r.id, ts: r.ts, player: r.player, type: r.type, ...(JSON.parse(r.data) as Partial<RaceEvent>),
    }));
    for (const e of events) {
      const reactions = this.reactionsOf(e.id);
      if (Object.keys(reactions).length) e.reactions = reactions;
    }
    return events;
  }

  private reactionsOf(event: number): Record<string, string[]> {
    const rows = this.db.prepare('SELECT player, emoji FROM reactions WHERE event = ?').all(event) as {
      player: string;
      emoji: string;
    }[];
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[r.emoji] ??= []).push(r.player);
    return out;
  }

  activeEffects(room: string, now = Date.now()): Effect[] {
    return this.db
      .prepare('SELECT id, target, by, item, until FROM effects WHERE room = ? AND until > ?')
      .all(room, now) as unknown as Effect[];
  }

  private timesOf(room: string): LapTime[] {
    return this.db.prepare('SELECT player, sector, ms FROM times WHERE room = ?').all(room) as unknown as LapTime[];
  }

  private historyOf(room: string): KmPoint[] {
    return this.db
      .prepare('SELECT player, ts, km FROM km_log WHERE room = ? ORDER BY ts LIMIT 20000')
      .all(room) as unknown as KmPoint[];
  }

  snapshot(room: string): Snapshot | null {
    const info = this.roomInfo(room);
    if (!info) return null;
    return {
      room: info,
      players: this.players(room),
      events: this.eventsOf(room),
      effects: this.activeEffects(room),
      times: this.timesOf(room),
      history: this.historyOf(room),
      now: Date.now(),
    };
  }

  /* ---- Joining ---- */

  join(room: string, body: Record<string, unknown>, now = Date.now()) {
    if (!this.roomInfo(room)) throw new GameError('This race does not exist.');
    const login = cleanText(body.login, 16).toLowerCase();
    const name = cleanText(body.name, 20) || login;
    const pin = String(body.pin ?? '');
    const kart = sanitizeKart(body.kart);
    if (!LOGIN_RE.test(login)) throw new GameError('Your login needs 2 to 16 lowercase letters, digits, - or _.');
    if (!PIN_RE.test(pin)) throw new GameError('Your PIN needs 4 to 8 digits.');
    if (!kart) throw new GameError('That kart is not street legal.');

    const count = this.db.prepare('SELECT COUNT(*) AS n FROM players WHERE room = ?').get(room) as { n: number };
    if (count.n >= MAX_PLAYERS) throw new GameError(`This race is full. ${MAX_PLAYERS} karts is the limit, obviously.`);
    if (this.db.prepare('SELECT 1 FROM players WHERE room = ? AND login = ?').get(room, login)) {
      throw new GameError('That login is already on the grid. Use "I already have a kart" with your PIN.');
    }

    const id = newId();
    const token = randomBytes(32).toString('base64url');
    const starter = this.rollItem(1, 2);
    this.db
      .prepare(
        `INSERT INTO players (id, room, login, name, kart, pin_hash, token_hash, joined_at, last_seen, items, item_refill_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, room, login, name, JSON.stringify(kart), hashPin(pin, room), sha256(token), now, now, JSON.stringify([starter]), now);

    // Starting position: what's already validated counts, without rewards or a burst of feed noise.
    const done = Array.isArray(body.done) ? body.done.filter((p): p is string => typeof p === 'string' && p in PROJECT_BY_ID) : [];
    const insert = this.db.prepare('INSERT OR IGNORE INTO progress (player, project, state, rewarded) VALUES (?, ?, ?, 1)');
    for (const project of done) insert.run(id, project, JSON.stringify({ s: 'done', g: 100 }));

    const player = this.toPublic(this.rowById(id)!);
    this.logKm(room, id, player.km, now);
    this.hooks.broadcast(room, { t: 'player', player });
    this.addEvent(room, id, 'join', { km: player.km }, now);
    return { token, playerId: id };
  }

  reclaim(room: string, body: Record<string, unknown>, now = Date.now()) {
    const login = cleanText(body.login, 16).toLowerCase();
    const pin = String(body.pin ?? '');
    const key = `${room}:${login}`;
    const failures = this.pinFailures.get(key);
    if (failures && failures.count >= 5 && failures.until > now) {
      throw new GameError('Too many wrong PINs. Wait a few minutes.');
    }
    const row = this.db.prepare('SELECT * FROM players WHERE room = ? AND login = ?').get(room, login) as PlayerRow | undefined;
    if (!row || !PIN_RE.test(pin) || !checkPin(pin, room, row.pin_hash)) {
      this.pinFailures.set(key, { count: (failures?.count ?? 0) + 1, until: now + 5 * 60_000 });
      throw new GameError('Wrong login or PIN.');
    }
    this.pinFailures.delete(key);
    // Each device gets its own session, so logging in on a phone leaves the cluster Mac signed in.
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT OR REPLACE INTO sessions (token_hash, player) VALUES (?, ?)').run(sha256(token), row.id);
    return { token, playerId: row.id };
  }

  /** Returns the player for a session token, if it belongs to this room. */
  authenticate(room: string, token: string): string | null {
    const hash = sha256(token);
    const direct = this.db.prepare('SELECT id FROM players WHERE room = ? AND token_hash = ?').get(room, hash) as
      | { id: string }
      | undefined;
    if (direct) return direct.id;
    const session = this.db
      .prepare('SELECT p.id FROM sessions s JOIN players p ON p.id = s.player WHERE p.room = ? AND s.token_hash = ?')
      .get(room, hash) as { id: string } | undefined;
    return session?.id ?? null;
  }

  /** Called when a player connects. Hands out the daily item and returns private state. */
  connect(playerId: string, now = Date.now()) {
    const row = this.rowById(playerId)!;
    let items = JSON.parse(row.items) as ItemId[];
    if (now - row.item_refill_at >= DAY && items.length < MAX_ITEMS) {
      const { rank, total } = this.rankOf(row.room, playerId);
      items = [...items, this.rollItem(rank, total)];
      this.db.prepare('UPDATE players SET items = ?, item_refill_at = ? WHERE id = ?').run(JSON.stringify(items), now, playerId);
    }
    return { id: playerId, items, lastSeen: row.last_seen };
  }

  touch(playerId: string, now = Date.now()) {
    this.db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now, playerId);
  }

  /* ---- Progress ---- */

  applyProject(playerId: string, id: string, action: ProjectAction, pct?: number, grade?: number, now = Date.now()) {
    const project = PROJECT_BY_ID[id];
    if (!project) throw new GameError('Unknown project.');
    const row = this.rowById(playerId)!;
    const room = row.room;
    const before = this.standings(room);
    const progressBefore = this.progressOf(playerId);
    const current = progressBefore[id];
    const wasDone = current?.s === 'done';
    const next: ProjectState = { ...current };

    switch (action) {
      case 'none':
        delete next.s;
        delete next.p;
        delete next.g;
        break;
      case 'wip':
        next.s = 'wip';
        next.p = Math.round(Math.min(Math.max(Number(pct) || 0, 0), MAX_WIP_PCT));
        delete next.g;
        break;
      case 'done':
        next.s = 'done';
        next.g = Math.round(Math.min(Math.max(Number(grade ?? 100) || 0, 0), MAX_GRADE));
        delete next.p;
        break;
      case 'fail':
        next.f = (next.f ?? 0) + 1;
        break;
      default:
        throw new GameError('Unknown action.');
    }

    // The row outlives an undo: it remembers that this project's item was already paid out.
    this.db
      .prepare(
        `INSERT INTO progress (player, project, state) VALUES (?, ?, ?)
         ON CONFLICT (player, project) DO UPDATE SET state = excluded.state`,
      )
      .run(playerId, id, JSON.stringify(next));

    if (action === 'wip' && !current?.s) this.addEvent(room, playerId, 'start', { project: id }, now);
    if (action === 'fail') this.addEvent(room, playerId, 'fail', { project: id, grade: Number(grade) || undefined }, now);
    if (action === 'done' && !wasDone) {
      this.addEvent(room, playerId, 'validate', { project: id, grade: next.g }, now);
      this.rewardValidation(playerId, id, next.g ?? 100);
    }

    const after = this.standings(room);
    const me = after.find((p) => p.id === playerId)!;
    const kmBefore = before.find((p) => p.id === playerId)!.km;
    if (me.km !== kmBefore) this.logKm(room, playerId, me.km, now);
    this.hooks.broadcast(room, { t: 'player', player: me });

    if (me.km > kmBefore) {
      const rankBefore = before.findIndex((p) => p.id === playerId);
      const rankAfter = after.findIndex((p) => p.id === playerId);
      if (rankAfter < rankBefore) {
        const passed = before[rankAfter];
        this.addEvent(room, playerId, 'overtake', { other: passed.id, km: me.km }, now);
      }
    }

    if (action === 'done' && !wasDone) {
      const progress = me.progress;
      const finishedNow = MODULES.filter((m) => isModuleDone(m.id, progress) && !isModuleDone(m.id, progressBefore));
      for (const m of finishedNow) this.addEvent(room, playerId, 'module', { module: m.id }, now);
      if (me.km >= TOTAL_KM) this.addEvent(room, playerId, 'finish', {}, now);
    }
  }

  private rewardValidation(playerId: string, project: string, grade: number) {
    const flag = this.db.prepare('SELECT rewarded FROM progress WHERE player = ? AND project = ?').get(playerId, project) as
      | { rewarded: number }
      | undefined;
    if (flag?.rewarded) return;
    this.db.prepare('UPDATE progress SET rewarded = 1 WHERE player = ? AND project = ?').run(playerId, project);
    const row = this.rowById(playerId)!;
    const { rank, total } = this.rankOf(row.room, playerId);
    const items = JSON.parse(row.items) as ItemId[];
    const boxes = grade >= 110 ? 2 : 1;
    let gained: ItemId | undefined;
    for (let i = 0; i < boxes && items.length < MAX_ITEMS; i++) {
      gained = this.rollItem(rank, total);
      items.push(gained);
    }
    this.db.prepare('UPDATE players SET items = ? WHERE id = ?').run(JSON.stringify(items), playerId);
    this.hooks.whisper(playerId, { t: 'me', items, gained });
  }

  private rankOf(room: string, playerId: string) {
    const standings = this.standings(room);
    return { rank: standings.findIndex((p) => p.id === playerId) + 1, total: standings.length };
  }

  /** The further back you are, the meaner the box. */
  private rollItem(rank: number, total: number): ItemId {
    const position = total <= 1 ? 0.5 : (rank - 1) / (total - 1);
    const weights: [ItemId, number][] = [
      ['coffee', 3],
      ['duck', 4 - 3 * position],
      ['norminette', 3],
      ['leak', 2 + position],
      ['segfault', 1 + 3 * position],
      ['moulinette', 0.3 + 3 * position],
    ];
    const sum = weights.reduce((a, [, w]) => a + w, 0);
    let roll = (randomInt(1_000_000) / 1_000_000) * sum;
    for (const [item, w] of weights) {
      roll -= w;
      if (roll <= 0) return item;
    }
    return 'coffee';
  }

  /* ---- Items ---- */

  useItem(playerId: string, now = Date.now()) {
    const row = this.rowById(playerId)!;
    const room = row.room;
    const items = JSON.parse(row.items) as ItemId[];
    const item = items[0];
    if (!item) throw new GameError('Your item slot is empty. Validate something.');

    const def = ITEMS[item];
    const standings = this.standings(room);
    const index = standings.findIndex((p) => p.id === playerId);
    let target: string | undefined;
    if (def.target === 'self') target = playerId;
    else if (def.target === 'leader') target = standings[0].id === playerId ? standings[1]?.id : standings[0].id;
    else target = index > 0 ? standings[index - 1].id : standings[1]?.id;
    if (!target) throw new GameError('Nobody else on the track to hit yet.');

    items.shift();
    this.db.prepare('UPDATE players SET items = ? WHERE id = ?').run(JSON.stringify(items), playerId);
    this.hooks.whisper(playerId, { t: 'me', items });
    this.broadcastPlayer(playerId);

    if (target !== playerId) {
      const shield = this.db
        .prepare(`SELECT id FROM effects WHERE room = ? AND target = ? AND item = 'duck' AND until > ? LIMIT 1`)
        .get(room, target, now) as { id: number } | undefined;
      if (shield) {
        this.db.prepare('DELETE FROM effects WHERE id = ?').run(shield.id);
        this.addEvent(room, target, 'blocked', { other: playerId, item }, now);
        this.hooks.broadcast(room, { t: 'effects', effects: this.activeEffects(room, now) });
        return;
      }
    }

    this.db
      .prepare('INSERT INTO effects (room, target, by, item, until) VALUES (?, ?, ?, ?, ?)')
      .run(room, target, playerId, item, now + def.hours * HOUR);
    this.addEvent(room, playerId, 'item', { other: target, item }, now);
    this.hooks.broadcast(room, { t: 'effects', effects: this.activeEffects(room, now) });
  }

  /* ---- Social ---- */

  react(playerId: string, eventId: number, emoji: string) {
    if (!(REACTIONS as readonly string[]).includes(emoji)) return;
    const row = this.rowById(playerId)!;
    const event = this.db.prepare('SELECT room FROM events WHERE id = ?').get(eventId) as { room: string } | undefined;
    if (event?.room !== row.room) return;
    const removed = this.db
      .prepare('DELETE FROM reactions WHERE event = ? AND player = ? AND emoji = ?')
      .run(eventId, playerId, emoji);
    if (!removed.changes) {
      this.db.prepare('INSERT INTO reactions (event, player, emoji) VALUES (?, ?, ?)').run(eventId, playerId, emoji);
    }
    this.hooks.broadcast(row.room, { t: 'react', ev: eventId, reactions: this.reactionsOf(eventId) });
  }

  shout(playerId: string, raw: unknown, now = Date.now()) {
    const text = cleanText(raw, 80);
    if (!text) return;
    this.addEvent(this.rowById(playerId)!.room, playerId, 'shout', { text }, now);
  }

  updateKart(playerId: string, rawKart: unknown, rawName: unknown) {
    const kart = sanitizeKart(rawKart);
    if (!kart) throw new GameError('That kart is not street legal.');
    const row = this.rowById(playerId)!;
    const name = cleanText(rawName, 20) || row.name;
    this.db.prepare('UPDATE players SET kart = ?, name = ? WHERE id = ?').run(JSON.stringify(kart), name, playerId);
    this.broadcastPlayer(playerId);
  }

  setExam(playerId: string, exam: NextExam | null) {
    const room = this.rowById(playerId)!.room;
    let value: string | null = null;
    if (exam) {
      const at = Number(exam.at);
      if (!Number.isFinite(at)) throw new GameError('That exam date makes no sense.');
      value = JSON.stringify({ name: cleanText(exam.name, 60) || 'Exam', at, place: cleanText(exam.place, 20) });
    }
    this.db.prepare('UPDATE rooms SET exam = ? WHERE code = ?').run(value, room);
    this.hooks.broadcast(room, { t: 'room', room: this.roomInfo(room)! });
  }

  setPace(playerId: string, end: number) {
    const room = this.rowById(playerId)!.room;
    const info = this.roomInfo(room)!;
    if (!Number.isFinite(end) || end <= info.paceStart) throw new GameError('The Black Hole cannot arrive before the race starts.');
    this.db.prepare('UPDATE rooms SET pace_end = ? WHERE code = ?').run(end, room);
    this.hooks.broadcast(room, { t: 'room', room: this.roomInfo(room)! });
  }

  recordTime(playerId: string, sector: number, ms: number, now = Date.now()) {
    if (!Number.isInteger(sector) || sector < 0 || sector >= MODULES.length) return;
    if (!Number.isFinite(ms) || ms < 1000 || ms > 600_000) return;
    const room = this.rowById(playerId)!.room;
    this.db
      .prepare(
        `INSERT INTO times (room, player, sector, ms, ts) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (room, player, sector) DO UPDATE SET ms = excluded.ms, ts = excluded.ts WHERE excluded.ms < times.ms`,
      )
      .run(room, playerId, sector, Math.round(ms), now);
    this.hooks.broadcast(room, { t: 'times', times: this.timesOf(room) });
  }

  /* ---- Internals ---- */

  private broadcastPlayer(playerId: string) {
    const row = this.rowById(playerId)!;
    this.hooks.broadcast(row.room, { t: 'player', player: this.toPublic(row) });
  }

  publicPlayer(playerId: string): PlayerPublic {
    return this.toPublic(this.rowById(playerId)!);
  }

  private logKm(room: string, player: string, km: number, now: number) {
    this.db.prepare('INSERT INTO km_log (room, player, ts, km) VALUES (?, ?, ?, ?)').run(room, player, now, km);
    this.hooks.broadcast(room, { t: 'km', point: { player, ts: now, km } });
  }

  private addEvent(room: string, player: string, type: EventType, data: Partial<RaceEvent>, now: number) {
    const result = this.db
      .prepare('INSERT INTO events (room, ts, player, type, data) VALUES (?, ?, ?, ?, ?)')
      .run(room, now, player, type, JSON.stringify(data));
    this.hooks.broadcast(room, { t: 'event', event: { id: Number(result.lastInsertRowid), ts: now, player, type, ...data } });
  }
}

