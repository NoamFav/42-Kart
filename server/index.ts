import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMsg, LivePacket, ServerMsg } from '../shared/protocol.ts';
import { openDb } from './db.ts';
import { GameError, Race } from './race.ts';

const PORT = Number(process.env.PORT ?? 4242);
const DB_PATH = process.env.DB_PATH ?? './data/kart.db';
const DIST = resolve('dist');

interface Client {
  ws: WebSocket;
  room: string | null;
  player: string | null;
  /** Token bucket that keeps one socket from flooding a room. */
  tokens: number;
  lastRefill: number;
}

const rooms = new Map<string, Set<Client>>();
const liveKarts = new Map<string, Map<string, LivePacket>>();

const send = (c: Client, msg: ServerMsg) => {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
};

const race = new Race(openDb(DB_PATH), {
  broadcast(room, msg) {
    const payload = JSON.stringify(msg);
    for (const c of rooms.get(room) ?? []) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
  },
  whisper(player, msg) {
    for (const set of rooms.values()) for (const c of set) if (c.player === player) send(c, msg);
  },
  isOnline(player) {
    for (const set of rooms.values()) for (const c of set) if (c.player === player) return true;
    return false;
  },
});

function broadcastPresence(room: string) {
  const online = [...new Set([...(rooms.get(room) ?? [])].flatMap((c) => (c.player ? [c.player] : [])))];
  const payload = JSON.stringify({ t: 'presence', online } satisfies ServerMsg);
  for (const c of rooms.get(room) ?? []) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
}

/* Live driving is relayed in batches at 12 Hz, not per packet. */
setInterval(() => {
  for (const [room, karts] of liveKarts) {
    if (!karts.size) continue;
    const payload = JSON.stringify({ t: 'live', karts: [...karts.values()] } satisfies ServerMsg);
    karts.clear();
    for (const c of rooms.get(room) ?? []) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
  }
}, 83);

/* ---- HTTP ---- */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > 16_384) throw new GameError('Request too large.');
    chunks.push(chunk);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    throw new GameError('Invalid JSON.');
  }
}

/* A very small per-IP limiter for the endpoints that create things. */
const hits = new Map<string, { count: number; reset: number }>();
function limited(req: IncomingMessage, max: number): boolean {
  const ip = String(req.headers['fly-client-ip'] ?? req.socket.remoteAddress ?? '?');
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.reset < now) {
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  return ++entry.count > max;
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  if (path === '/api/health') return json(res, 200, { ok: true });

  if (req.method === 'POST' && path === '/api/rooms') {
    if (limited(req, 10)) return json(res, 429, { error: 'Slow down a little.' });
    const body = await readBody(req);
    return json(res, 200, race.createRoom(body.name));
  }

  const match = path.match(/^\/api\/rooms\/([a-z0-9-]{1,48})(\/join|\/reclaim)?$/);
  if (!match) return json(res, 404, { error: 'Not found.' });
  const [, code, action] = match;

  if (req.method === 'GET' && !action) {
    const room = race.roomInfo(code);
    return room ? json(res, 200, room) : json(res, 404, { error: 'This race does not exist.' });
  }
  if (req.method === 'POST' && action) {
    if (limited(req, 20)) return json(res, 429, { error: 'Slow down a little.' });
    const body = await readBody(req);
    return json(res, 200, action === '/join' ? race.join(code, body) : race.reclaim(code, body));
  }
  return json(res, 405, { error: 'Method not allowed.' });
}

function serveStatic(res: ServerResponse, path: string) {
  let decoded = '/';
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A malformed escape is just a page that does not exist.
  }
  const wanted = normalize(join(DIST, decoded));
  const inside = wanted.startsWith(DIST + sep);
  const file = inside && existsSync(wanted) && statSync(wanted).isFile() ? wanted : join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('Client not built. Run npm run build, or use the Vite dev server.');
    return;
  }
  const immutable = file.includes(`${DIST}/assets/`);
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url ?? '/', 'http://x').pathname;
  } catch {
    // Unparseable request line: treat it as the home page.
  }
  if (!pathname.startsWith('/api/')) return serveStatic(res, pathname);
  api(req, res, pathname).catch((error: unknown) => {
    if (error instanceof GameError) return json(res, 400, { error: error.message });
    console.error(error);
    json(res, 500, { error: 'The server segfaulted. Try again.' });
  });
});

/* ---- WebSocket ---- */

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8192 });

function allow(c: Client, cost: number): boolean {
  const now = Date.now();
  c.tokens = Math.min(60, c.tokens + ((now - c.lastRefill) / 1000) * 25);
  c.lastRefill = now;
  if (c.tokens < cost) return false;
  c.tokens -= cost;
  return true;
}

function handle(c: Client, msg: ClientMsg) {
  if (msg.t === 'hello') {
    if (c.room) return;
    const code = String(msg.room);
    const snapshot = race.snapshot(code);
    if (!snapshot) return send(c, { t: 'error', message: 'This race does not exist.' });
    c.room = code;
    c.player = msg.token ? race.authenticate(code, String(msg.token)) : null;
    let set = rooms.get(code);
    if (!set) rooms.set(code, (set = new Set()));
    set.add(c);
    const me = c.player ? race.connect(c.player) : null;
    const fresh = race.snapshot(code)!;
    send(c, { t: 'snapshot', me, ...fresh });
    if (c.player) race.touch(c.player);
    broadcastPresence(code);
    return;
  }

  const { room, player } = c;
  if (!room || !player) return; // Spectators watch; they don't touch.

  switch (msg.t) {
    case 'project': return race.applyProject(player, String(msg.id), msg.action, msg.pct, msg.grade);
    case 'item': return race.useItem(player);
    case 'honk': {
      const payload: ServerMsg = { t: 'honk', id: player };
      for (const peer of rooms.get(room) ?? []) send(peer, payload);
      return;
    }
    case 'react': return race.react(player, Number(msg.ev), String(msg.emoji));
    case 'shout': return race.shout(player, msg.text);
    case 'kart': return race.updateKart(player, msg.kart, msg.name);
    case 'exam': return race.setExam(player, msg.exam);
    case 'pace': return race.setPace(player, Number(msg.end));
    case 'time': return race.recordTime(player, Number(msg.sector), Number(msg.ms));
    case 'live': {
      const nums = [msg.s, msg.l, msg.h, msg.v, msg.d].map(Number);
      if (nums.some((n) => !Number.isFinite(n))) return;
      let karts = liveKarts.get(room);
      if (!karts) liveKarts.set(room, (karts = new Map()));
      karts.set(player, [player, nums[0], nums[1], nums[2], nums[3], nums[4]]);
      return;
    }
    case 'liveEnd': {
      const payload: ServerMsg = { t: 'liveEnd', id: player };
      for (const peer of rooms.get(room) ?? []) send(peer, payload);
    }
  }
}

wss.on('connection', (ws) => {
  const c: Client = { ws, room: null, player: null, tokens: 60, lastRefill: Date.now() };
  let alive = true;
  ws.on('pong', () => (alive = true));
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 30_000);

  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(String(data)) as ClientMsg;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (!allow(c, msg.t === 'live' ? 0.5 : 2)) return;
    try {
      handle(c, msg);
    } catch (error) {
      if (error instanceof GameError) send(c, { t: 'error', message: error.message });
      else console.error(error);
    }
  });

  ws.on('close', () => {
    clearInterval(ping);
    if (!c.room) return;
    const set = rooms.get(c.room);
    set?.delete(c);
    if (c.player) {
      race.touch(c.player);
      for (const peer of set ?? []) send(peer, { t: 'liveEnd', id: c.player });
    }
    if (set?.size) broadcastPresence(c.room);
    else rooms.delete(c.room);
  });
});

server.listen(PORT, () => console.log(`42 Kart on :${PORT}, db ${DB_PATH}`));

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
