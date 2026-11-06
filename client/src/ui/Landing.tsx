import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { PROJECTS, SECTORS, TOTAL_KM } from '../../../shared/curriculum.ts';
import type { BodyId, DriverId, PlayerPublic } from '../../../shared/protocol.ts';
import { world } from '../stage.ts';
import { createRoom } from '../store.ts';
import { km } from '../format.ts';

const CAST: [string, BodyId, DriverId, string, string][] = [
  ['cadet', 'classic', 'cadet', '#00babc', '#f2f4f8'],
  ['duck', 'chair', 'duck', '#2f7bff', '#ffd21f'],
  ['cat', 'wedge', 'cat', '#ff3b4e', '#20242e'],
  ['root', 'rover', 'penguin', '#ffd21f', '#20242e'],
  ['bot', 'hover', 'bot', '#8a5cff', '#59f0ff'],
  ['bug', 'wedge', 'bug', '#35d07f', '#f2f4f8'],
];

const demoRoster = (): PlayerPublic[] =>
  CAST.map(([name, body, driver, paint, accent], i) => ({
    id: `demo-${i}`, login: name, name, km: 90 + i * 240, bonus: 0, online: true, joinedAt: i, lastSeen: 0,
    itemCount: 0, progress: {}, kart: { body, driver, paint, accent, number: 7 * (i + 1) },
  }));

export function Landing({ go }: { go(path: string): void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const w = world();
    if (!w) return;
    w.cruise = true;
    w.setRoster(demoRoster(), [], null);
    w.setPace(null);
    w.setFullyLit(true);
    w.setMode('tour', 'demo-1');
    return () => {
      w.cruise = false;
      w.setRoster([], [], null);
    };
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const room = await createRoom(name);
      go(`/r/${room.code}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toLowerCase().replace(/^.*\/r\//, '');
    if (clean) go(`/r/${clean}`);
  };

  return (
    <main className="landing">
      <div className="landing-copy">
        <p className="pixel kicker">Common core grand prix</p>
        <h1 className="logo">42<span>Kart</span></h1>
        <p className="lede">
          Your cohort, on one track. Every validated hour moves your kart one kilometre, live, in front of everyone.
        </p>

        <form className="landing-form" onSubmit={create}>
          <label className="pixel" htmlFor="race-name">Start a race</label>
          <div className="field-row">
            <input id="race-name" value={name} maxLength={40} placeholder="Name it, or leave it blank" onChange={(e) => setName(e.target.value)} />
            <button className="btn primary" disabled={busy}>{busy ? 'Building' : 'Create race'}</button>
          </div>
        </form>
        <form className="landing-form" onSubmit={join}>
          <label className="pixel" htmlFor="race-code">Got an invite?</label>
          <div className="field-row">
            <input id="race-code" value={code} placeholder="dangling-pointer-17" autoCapitalize="none" spellCheck={false} onChange={(e) => setCode(e.target.value)} />
            <button className="btn" disabled={!code.trim()}>Join</button>
          </div>
        </form>
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>

      <dl className="landing-stats">
        <div><dt className="pixel">Distance</dt><dd>{km(TOTAL_KM)} km</dd></div>
        <div><dt className="pixel">Projects</dt><dd>{PROJECTS.filter((p) => p.kind !== 'step').length}</dd></div>
        <div><dt className="pixel">Sectors</dt><dd>{SECTORS.length}</dd></div>
      </dl>
      <p className="landing-foot pixel">Unofficial. Made by students, for students.</p>
    </main>
  );
}
