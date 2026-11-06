import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_KART } from '../shared/protocol.ts';
import type { ServerMsg } from '../shared/protocol.ts';
import {
  MODULES, PROJECTS, SECTORS, TOTAL_KM, ancestorsOf, distanceOf, modulesProjects,
} from '../shared/curriculum.ts';
import { openDb } from '../server/db.ts';
import { GameError, Race } from '../server/race.ts';

function setup() {
  const sent: ServerMsg[] = [];
  const whispered: { id: string; msg: ServerMsg }[] = [];
  const race = new Race(openDb(':memory:'), {
    broadcast: (_room, msg) => sent.push(msg),
    whisper: (id, msg) => whispered.push({ id, msg }),
    isOnline: () => false,
  });
  const room = race.createRoom('Test').code;
  const join = (login: string, done: string[] = [], at = Date.now()) =>
    race.join(room, { login, name: login, pin: '4242', kart: DEFAULT_KART, done }, at).playerId;
  const events = () => sent.flatMap((m) => (m.t === 'event' ? [m.event] : []));
  return { race, room, join, sent, whispered, events };
}

test('the curriculum matches the slide, module by module', () => {
  const hours = (id: Parameters<typeof modulesProjects>[0]) =>
    modulesProjects(id).filter((p) => p.kind !== 'exam').reduce((a, p) => a + p.km, 0);
  assert.equal(hours('fund'), 240);
  assert.equal(hours('oop'), 270);
  assert.equal(hours('admin'), 250);
  assert.equal(hours('algo'), 190);
  assert.equal(hours('ai'), 330);
  assert.equal(hours('net'), 220); // Slide header says 230, its boxes say 70 + 150.
  assert.equal(hours('web'), 280);
});

test('push_swap is only counted once in the race distance', () => {
  assert.equal(PROJECTS.filter((p) => p.id === 'push_swap').length, 1);
  assert.equal(TOTAL_KM, 1870);
  assert.equal(SECTORS.at(-1)!.end, TOTAL_KM);
  assert.equal(SECTORS.length, MODULES.length);
});

test('every prerequisite exists and comes earlier on the track or in a parallel branch', () => {
  const ids = new Set(PROJECTS.map((p) => p.id));
  for (const p of PROJECTS) for (const r of p.requires) assert.ok(ids.has(r), `${p.id} needs ${r}`);
  assert.deepEqual(new Set(ancestorsOf('push_swap')), new Set(['libft', 'ft_printf', 'get_next_line']));
});

test('work in progress cannot reach the end of a project without a validation', () => {
  assert.equal(distanceOf({ libft: { s: 'wip', p: 100 } }), 63);
  assert.equal(distanceOf({ libft: { s: 'done', g: 100 } }), 70);
});

test('heavier projects move you further', () => {
  const { race, join } = setup();
  const a = join('alice');
  const b = join('bob');
  race.applyProject(a, 'libft', 'done', undefined, 100);
  race.applyProject(b, 'get_next_line', 'done', undefined, 100);
  assert.equal(race.publicPlayer(a).km, 70);
  assert.equal(race.publicPlayer(b).km, 45);
});

test('grade is clamped and bonus breaks ties', () => {
  const { race, room, join } = setup();
  const a = join('alice');
  const b = join('bob');
  race.applyProject(a, 'libft', 'done', undefined, 100);
  race.applyProject(b, 'libft', 'done', undefined, 999);
  assert.equal(race.publicPlayer(b).progress.libft.g, 125);
  assert.equal(race.standings(room)[0].id, b);
});

test('overtaking is detected once, against the kart actually passed', () => {
  const { race, join, events } = setup();
  const a = join('alice');
  const b = join('bob');
  race.applyProject(a, 'get_next_line', 'done');
  race.applyProject(b, 'libft', 'done');
  const overtakes = events().filter((e) => e.type === 'overtake');
  assert.equal(overtakes.length, 2 - 1);
  assert.equal(overtakes[0].player, b);
  assert.equal(overtakes[0].other, a);
});

test('toggling a validation does not farm items', () => {
  const { race, join, whispered } = setup();
  const a = join('alice');
  race.applyProject(a, 'libft', 'done');
  race.applyProject(a, 'libft', 'none');
  race.applyProject(a, 'libft', 'done');
  assert.equal(whispered.filter((w) => w.msg.t === 'me' && w.msg.gained).length, 1);
});

test('a failed evaluation is counted without moving the kart', () => {
  const { race, join, events } = setup();
  const a = join('alice');
  race.applyProject(a, 'libft', 'wip', 50);
  race.applyProject(a, 'libft', 'fail');
  const me = race.publicPlayer(a);
  assert.equal(me.km, 35);
  assert.equal(me.progress.libft.f, 1);
  assert.equal(events().filter((e) => e.type === 'fail').length, 1);
});

test('finishing a module and the race emit their events', () => {
  const { race, join, events } = setup();
  const a = join('alice', PROJECTS.filter((p) => p.id !== 'ft_transcendence').map((p) => p.id));
  race.applyProject(a, 'ft_transcendence', 'done');
  assert.equal(race.publicPlayer(a).km, TOTAL_KM);
  assert.ok(events().some((e) => e.type === 'module' && e.module === 'web'));
  assert.ok(events().some((e) => e.type === 'finish'));
});

test('joining with validated projects places you there without rewards', () => {
  const { race, join, whispered } = setup();
  const a = join('alice', ['libft', 'ft_printf', 'nonsense']);
  assert.equal(race.publicPlayer(a).km, 125);
  race.applyProject(a, 'libft', 'none');
  race.applyProject(a, 'libft', 'done');
  assert.equal(whispered.filter((w) => w.msg.t === 'me' && w.msg.gained).length, 0);
});

test('items hit the kart ahead and the duck blocks one attack', () => {
  const { race, room, join, events } = setup();
  const leader = join('leader', ['libft']);
  const chaser = join('chaser');
  const db = (race as unknown as { db: ReturnType<typeof openDb> }).db;
  const give = (id: string, items: string[]) =>
    db.prepare('UPDATE players SET items = ? WHERE id = ?').run(JSON.stringify(items), id);

  give(chaser, ['segfault', 'segfault']);
  race.useItem(chaser);
  assert.deepEqual(race.activeEffects(room).map((e) => [e.target, e.item]), [[leader, 'segfault']]);

  give(leader, ['duck']);
  race.useItem(leader);
  assert.equal(race.activeEffects(room).filter((e) => e.item === 'duck').length, 1);
  give(chaser, ['leak']);
  race.useItem(chaser);
  assert.equal(race.activeEffects(room).filter((e) => e.item === 'duck').length, 0);
  assert.equal(race.activeEffects(room).filter((e) => e.item === 'leak').length, 0);
  assert.ok(events().some((e) => e.type === 'blocked'));
  assert.equal(race.publicPlayer(leader).km, 70, 'items never change distance');
});

test('using an empty slot is refused', () => {
  const { race, join } = setup();
  const a = join('alice');
  const db = (race as unknown as { db: ReturnType<typeof openDb> }).db;
  db.prepare(`UPDATE players SET items = '[]' WHERE id = ?`).run(a);
  assert.throws(() => race.useItem(a), GameError);
});

test('the daily item is granted once per day, capped at three', () => {
  const { race, join } = setup();
  const t0 = 1_800_000_000_000;
  const a = join('alice', [], t0);
  assert.equal(race.connect(a, t0 + 1000).items.length, 1);
  assert.equal(race.connect(a, t0 + 86_400_000).items.length, 2);
  assert.equal(race.connect(a, t0 + 86_400_001).items.length, 2);
  assert.equal(race.connect(a, t0 + 2 * 86_400_000).items.length, 3);
  assert.equal(race.connect(a, t0 + 3 * 86_400_000).items.length, 3);
});

test('PIN login returns a session and locks after repeated failures', () => {
  const { race, room, join } = setup();
  const a = join('alice');
  const { token } = race.reclaim(room, { login: 'alice', pin: '4242' });
  assert.equal(race.authenticate(room, token), a);
  for (let i = 0; i < 5; i++) assert.throws(() => race.reclaim(room, { login: 'alice', pin: '0000' }), /Wrong/);
  assert.throws(() => race.reclaim(room, { login: 'alice', pin: '4242' }), /Too many/);
});

test('a session does not work in another room', () => {
  const { race, join } = setup();
  join('alice');
  const other = race.createRoom('Other').code;
  const { token } = race.join(other, { login: 'bob', pin: '1234', kart: DEFAULT_KART });
  const first = race.createRoom('Third').code;
  assert.equal(race.authenticate(first, token), null);
});

test('login, PIN and kart are validated', () => {
  const { race, room } = setup();
  const base = { login: 'alice', pin: '4242', kart: DEFAULT_KART };
  assert.throws(() => race.join(room, { ...base, login: '<script>' }), GameError);
  assert.throws(() => race.join(room, { ...base, pin: '12' }), GameError);
  assert.throws(() => race.join(room, { ...base, kart: { ...DEFAULT_KART, paint: 'red;' } }), GameError);
  race.join(room, base);
  assert.throws(() => race.join(room, base), /already on the grid/);
});

test('lap times only ever improve', () => {
  const { race, room, join } = setup();
  const a = join('alice');
  race.recordTime(a, 0, 40_000);
  race.recordTime(a, 0, 50_000);
  race.recordTime(a, 0, 30_000);
  assert.equal(race.snapshot(room)!.times[0].ms, 30_000);
});
