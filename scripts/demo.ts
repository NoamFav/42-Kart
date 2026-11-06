/**
 * Fills a local race with bots so the track has life on it: `npm run demo`.
 * Talks to a running server (npm run dev) exactly the way the browser does.
 */
import { WebSocket } from 'ws';
import { PROJECTS } from '../shared/curriculum.ts';
import type { ClientMsg, KartConfig, ServerMsg } from '../shared/protocol.ts';

const BASE = process.env.BASE ?? 'http://localhost:4242';

const CAST: [string, string, KartConfig, number][] = [
  ['ychen', 'Yuki', { body: 'classic', driver: 'cadet', paint: '#00babc', accent: '#f2f4f8', number: 42 }, 3],
  ['lmartin', 'Lea', { body: 'wedge', driver: 'cat', paint: '#ff3b4e', accent: '#20242e', number: 7 }, 18],
  ['tdubois', 'Tom', { body: 'chair', driver: 'duck', paint: '#2f7bff', accent: '#ffd21f', number: 13 }, 2],
  ['aweber', 'Ana', { body: 'rover', driver: 'penguin', paint: '#ffd21f', accent: '#20242e', number: 21 }, 10],
  ['mkeller', 'Max', { body: 'hover', driver: 'bot', paint: '#8a5cff', accent: '#59f0ff', number: 99 }, 23],
  ['sroche', 'Sam', { body: 'wedge', driver: 'bug', paint: '#35d07f', accent: '#f2f4f8', number: 4 }, 6],
];

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${await res.text()}`);
  return (await res.json()) as T;
}

const room = process.argv[2] ?? (await post<{ code: string }>('/api/rooms', { name: 'Cluster Grand Prix' })).code;
console.log(`Race: http://localhost:5173/r/${room}`);

const main = PROJECTS.filter((p) => p.kind !== 'exam');

interface Bot { ws: WebSocket; send(m: ClientMsg): void; index: number; name: string }
const bots: Bot[] = [];

for (const [login, name, kart, count] of CAST) {
  const done = main.slice(0, count).map((p) => p.id);
  const { token } = await post<{ token: string }>(`/api/rooms/${room}/join`, { login, name, pin: '4242', kart, done });
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/ws');
  await new Promise((resolve) => ws.on('open', resolve));
  const send = (m: ClientMsg) => ws.send(JSON.stringify(m));
  ws.on('message', (data) => {
    const msg = JSON.parse(String(data)) as ServerMsg;
    if (msg.t === 'error') console.log(name, msg.message);
  });
  send({ t: 'hello', room, token });
  bots.push({ ws, send, index: count, name });
  send({ t: 'project', id: main[count].id, action: 'wip', pct: 20 + Math.floor(Math.random() * 60) });
}

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const lines = ['norminette says hi', 'who left a segfault on turn 3', 'see you at the exam', 'one more evaluation', 'printf is not a debugger'];

const interval = Number(process.env.EVERY ?? 9000);
setInterval(() => {
  const bot = pick(bots);
  const roll = Math.random();
  const project = main[bot.index];
  if (roll < 0.45 && project) {
    bot.send({ t: 'project', id: project.id, action: 'done', grade: pick([100, 100, 100, 112, 125]) });
    bot.index++;
    const next = main[bot.index];
    if (next) bot.send({ t: 'project', id: next.id, action: 'wip', pct: 10 });
  } else if (roll < 0.6 && project) {
    bot.send({ t: 'project', id: project.id, action: 'fail', grade: pick([0, 30, 42, 60]) });
  } else if (roll < 0.8) bot.send({ t: 'item' });
  else if (roll < 0.9) bot.send({ t: 'shout', text: pick(lines) });
  else bot.send({ t: 'honk' });
}, interval);
