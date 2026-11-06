import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  pace_start INTEGER NOT NULL,
  pace_end INTEGER NOT NULL,
  exam TEXT
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  room TEXT NOT NULL REFERENCES rooms(code),
  login TEXT NOT NULL,
  name TEXT NOT NULL,
  kart TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  item_refill_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE (room, login)
);
CREATE INDEX IF NOT EXISTS players_token ON players(token_hash);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  player TEXT NOT NULL REFERENCES players(id)
);
CREATE TABLE IF NOT EXISTS progress (
  player TEXT NOT NULL REFERENCES players(id),
  project TEXT NOT NULL,
  state TEXT NOT NULL,
  rewarded INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player, project)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  ts INTEGER NOT NULL,
  player TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_room ON events(room, id);
CREATE TABLE IF NOT EXISTS reactions (
  event INTEGER NOT NULL,
  player TEXT NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (event, player, emoji)
);
CREATE TABLE IF NOT EXISTS km_log (
  room TEXT NOT NULL,
  player TEXT NOT NULL,
  ts INTEGER NOT NULL,
  km REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS km_room ON km_log(room, ts);
CREATE TABLE IF NOT EXISTS effects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room TEXT NOT NULL,
  target TEXT NOT NULL,
  by TEXT NOT NULL,
  item TEXT NOT NULL,
  until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS times (
  room TEXT NOT NULL,
  player TEXT NOT NULL,
  sector INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (room, player, sector)
);
`;

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}
