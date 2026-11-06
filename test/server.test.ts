import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { DEFAULT_KART } from '../shared/protocol.ts';
import type { ClientMsg, ServerMsg } from '../shared/protocol.ts';

const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'kart-'));
let server: ReturnType<typeof spawn>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(path: string, body: unknown) {
  const res = await fetch(BASE + path, { method: 'POST', body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const inbox: ServerMsg[] = [];
  ws.on('message', (d) => inbox.push(JSON.parse(String(d)) as ServerMsg));
  const opened = new Promise((r) => ws.on('open', r));
  return {
    ws, inbox, opened,
    send: (m: ClientMsg) => ws.send(JSON.stringify(m)),
    async waitFor<T extends ServerMsg['t']>(t: T, test: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true) {
      for (let i = 0; i < 200; i++) {
        const hit = inbox.find((m) => m.t === t && test(m as Extract<ServerMsg, { t: T }>));
        if (hit) return hit as Extract<ServerMsg, { t: T }>;
        await sleep(10);
      }
      throw new Error(`No ${t} received`);
    },
  };
}

before(async () => {
  server = spawn('node', ['server/index.ts'], { env: { ...process.env, PORT: String(PORT), DB_PATH: join(dir, 'k.db') }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      await sleep(50);
    }
  }
  throw new Error('Server did not start');
});

after(() => {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
});

test('two clients see each other validate, live', async () => {
  const room = (await post('/api/rooms', { name: 'Live' })).body.code;
  const a = await post(`/api/rooms/${room}/join`, { login: 'alice', pin: '1234', kart: DEFAULT_KART });
  const b = await post(`/api/rooms/${room}/join`, { login: 'bob', pin: '1234', kart: DEFAULT_KART });

  const alice = client();
  const bob = client();
  await Promise.all([alice.opened, bob.opened]);
  alice.send({ t: 'hello', room, token: a.body.token });
  bob.send({ t: 'hello', room, token: b.body.token });
  await bob.waitFor('snapshot');
  await alice.waitFor('snapshot');

  alice.send({ t: 'project', id: 'libft', action: 'done', grade: 125 });
  const update = await bob.waitFor('player', (m) => m.player.login === 'alice' && m.player.km === 70);
  assert.equal(update.player.bonus, 25);
  await bob.waitFor('event', (m) => m.event.type === 'validate');
  await alice.waitFor('me', (m) => !!m.gained);

  alice.send({ t: 'live', s: 200, l: 1, h: 0, v: 40, d: 0 });
  const live = await bob.waitFor('live');
  assert.equal(live.karts[0][1], 200);

  alice.ws.close();
  await bob.waitFor('presence', (m) => m.online.length === 1);
  bob.ws.close();
});

test('spectators can watch but change nothing', async () => {
  const room = (await post('/api/rooms', {})).body.code;
  await post(`/api/rooms/${room}/join`, { login: 'alice', pin: '1234', kart: DEFAULT_KART });
  const spy = client();
  await spy.opened;
  spy.send({ t: 'hello', room, token: 'forged-token' });
  const snapshot = await spy.waitFor('snapshot');
  assert.equal(snapshot.me, null);
  assert.equal(JSON.stringify(snapshot).includes('hash'), false, 'no secrets in the snapshot');

  spy.send({ t: 'project', id: 'libft', action: 'done' });
  spy.send({ t: 'shout', text: 'pwned' });
  await sleep(100);
  assert.equal(spy.inbox.filter((m) => m.t === 'event').length, 0);
  spy.ws.close();
});

test('garbage on the socket or in the URL does not bring the server down', async () => {
  const room = (await post('/api/rooms', {})).body.code;
  const joined = await post(`/api/rooms/${room}/join`, { login: 'mallory', pin: '1234', kart: DEFAULT_KART });
  const c = client();
  await c.opened;
  for (const raw of ['null', '[]', '42', '"x"', '{', '{"t":null}', '{"t":"hello"}', '{"t":"hello","room":{}}']) c.ws.send(raw);
  c.send({ t: 'hello', room, token: joined.body.token });
  await c.waitFor('snapshot');
  const nasty: unknown[] = [
    { t: 'project' }, { t: 'project', id: '__proto__', action: 'done' }, { t: 'project', id: 'libft', action: 'nope' },
    { t: 'project', id: 'libft', action: 'wip', pct: 'lots' }, { t: 'kart', kart: null }, { t: 'kart', kart: { body: 'tank' } },
    { t: 'exam', exam: 5 }, { t: 'pace', end: 'never' }, { t: 'time', sector: 99, ms: 1 }, { t: 'react', ev: 'x', emoji: 'y' },
    { t: 'live', s: 'NaN' }, { t: 'shout', text: { a: 1 } }, { t: 'unknown' },
  ];
  for (const m of nasty) c.ws.send(JSON.stringify(m));
  await sleep(150);

  for (const path of ['/%E0%A4%A', '/..%2f..%2fetc/passwd', '/api/rooms/%ff']) {
    const res = await fetch(BASE + path);
    assert.ok(res.status < 500, `${path} gave ${res.status}`);
    assert.equal((await res.text()).includes('root:'), false);
  }
  assert.equal((await fetch(`${BASE}/api/health`)).status, 200);
  c.ws.close();
});

test('progress survives a reconnect', async () => {
  const room = (await post('/api/rooms', {})).body.code;
  const joined = await post(`/api/rooms/${room}/join`, { login: 'alice', pin: '1234', kart: DEFAULT_KART, done: ['libft'] });
  const again = await post(`/api/rooms/${room}/reclaim`, { login: 'alice', pin: '1234' });
  assert.notEqual(again.body.token, joined.body.token);
  const c = client();
  await c.opened;
  c.send({ t: 'hello', room, token: again.body.token });
  const snapshot = await c.waitFor('snapshot');
  assert.equal(snapshot.me?.id, joined.body.playerId);
  assert.equal(snapshot.players[0].km, 70);
  c.ws.close();
});
