import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { MODULE_BY_ID, PROJECTS, PROJECT_BY_ID, SECTORS, TOTAL_KM, sectorAt } from '../../../shared/curriculum.ts';
import { ITEMS, REACTIONS } from '../../../shared/protocol.ts';
import type { ItemId, PlayerPublic, RaceEvent } from '../../../shared/protocol.ts';
import { sfx } from '../audio.ts';
import { ago, countdown, km, shortDate } from '../format.ts';
import type { CameraMode } from '../game/world.ts';
import { startReplay, stopReplay } from '../replay.ts';
import { getState, playerById, rankPlayers, send, setState, signOut, toast, useStore } from '../store.ts';
import { Icon, ItemIcon } from './Icons.tsx';

export const paceKm = (start: number, end: number, now: number) =>
  Math.min(TOTAL_KM, Math.max(0, ((now - start) / (end - start)) * TOTAL_KM));

const nameOf = (id?: string) => playerById(id)?.name ?? 'someone';
const shortProject = (id?: string) => (id ? PROJECT_BY_ID[id]?.name.replace('Exam: ', 'exam ') : '') ?? '';

/* ---- Timing tower ---- */

export function Tower({ focus, onFocus }: { focus: string | null; onFocus(id: string): void }) {
  const players = useStore((s) => s.players);
  const room = useStore((s) => s.room);
  const meId = useStore((s) => s.meId);
  const replay = useStore((s) => s.replay);
  const [collapsed, setCollapsed] = useState(false);

  const ranked = useMemo(() => rankPlayers(players, replay?.km), [players, replay]);
  const leaderKm = replay?.km[ranked[0]?.id] ?? ranked[0]?.km ?? 0;
  const now = replay?.t ?? Date.now();
  const hole = room ? paceKm(room.paceStart, room.paceEnd, now) : 0;
  const holeIndex = ranked.findIndex((p) => (replay?.km[p.id] ?? p.km) < hole);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Invite link copied. Send it to the cluster.');
    } catch {
      toast(location.href);
    }
  };

  const row = (p: PlayerPublic, i: number) => {
    const value = replay?.km[p.id] ?? p.km;
    return (
      <li key={p.id}>
        <button className={`tower-row ${p.id === meId ? 'me' : ''} ${p.id === focus ? 'focus' : ''}`} onClick={() => onFocus(p.id)}>
          <span className="tower-pos">{i + 1}</span>
          <span className="tower-paint" style={{ background: p.kart.paint }} />
          <span className="tower-name">
            {p.name}
            {p.online && <i className="live-dot" title="Online" />}
          </span>
          <span className="tower-gap">{i === 0 ? `${km(value)}` : `+${km(leaderKm - value)}`}</span>
        </button>
      </li>
    );
  };

  return (
    <nav className={`tower ${collapsed ? 'collapsed' : ''}`} aria-label="Standings">
      <header>
        <button className="tower-title" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          <b>{room?.name ?? 'Loading'}</b>
          <span className="pixel">{ranked.length ? `${ranked.length} ${ranked.length === 1 ? 'kart' : 'karts'}` : 'empty grid'}</span>
        </button>
        <button className="icon-btn small" onClick={copy} aria-label="Copy invite link" title="Copy invite link"><Icon.Copy /></button>
      </header>
      {!collapsed && (
        <ol>
          {ranked.map((p, i) => (
            <FragmentRow key={p.id} before={i === holeIndex && hole > 1 ? <HoleRow km={hole} /> : null}>{row(p, i)}</FragmentRow>
          ))}
          {holeIndex === -1 && hole > 1 && ranked.length > 0 && <HoleRow km={hole} />}
        </ol>
      )}
    </nav>
  );
}

const FragmentRow = ({ before, children }: { before: ReactNode; children: ReactNode }) => <>{before}{children}</>;

const HoleRow = ({ km: value }: { km: number }) => (
  <li className="tower-hole" title="The Black Hole advances at the pace of your deadline. Stay ahead of it.">
    <Icon.Hole /><span>Black Hole</span><b>{km(value)}</b>
  </li>
);

/* ---- Track strip ---- */

export function Strip({ onFocus }: { onFocus(id: string): void }) {
  const players = useStore((s) => s.players);
  const room = useStore((s) => s.room);
  const meId = useStore((s) => s.meId);
  const replay = useStore((s) => s.replay);
  const now = replay?.t ?? Date.now();
  const hole = room ? paceKm(room.paceStart, room.paceEnd, now) : 0;
  const pct = (value: number) => `${(value / TOTAL_KM) * 100}%`;
  const me = players.find((p) => p.id === meId);
  const here = sectorAt(me?.km ?? rankPlayers(players)[0]?.km ?? 0);

  return (
    <div className="strip" aria-label="Race progress">
      <div className="strip-label">
        {replay ? (
          <>
            <b>{shortDate(replay.t)}</b>
            <button className="link" onClick={() => stopReplay()}>Stop replay</button>
          </>
        ) : (
          <>
            <b style={{ color: here.color }}>{here.sector}</b>
            <span className="strip-blurb">{here.blurb}</span>
            <span className="pixel">{km(me?.km ?? 0)} / {km(TOTAL_KM)} km</span>
          </>
        )}
      </div>
      <div className="strip-track">
        {SECTORS.map((s) => (
          <span key={s.id} className="strip-sector" title={`${s.sector}: ${s.name}`} style={{ left: pct(s.start), width: pct(s.end - s.start), background: s.color }} />
        ))}
        {PROJECTS.filter((p) => p.kind !== 'step').map((p) => <i key={p.id} className="strip-tick" style={{ left: pct(p.end) }} />)}
        {hole > 1 && <span className="strip-hole" style={{ left: pct(hole) }} title="Black Hole"><Icon.Hole /></span>}
        {players.map((p) => (
          <button
            key={p.id}
            className={`strip-kart ${p.id === meId ? 'me' : ''}`}
            title={p.name}
            aria-label={`${p.name}, ${km(p.km)} km`}
            style={{ left: pct(replay?.km[p.id] ?? p.km), ['--paint' as string]: p.kart.paint }}
            onClick={() => onFocus(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

/* ---- Feed ---- */

function line(e: RaceEvent): ReactNode {
  const who = <b>{nameOf(e.player)}</b>;
  const other = <b>{nameOf(e.other)}</b>;
  const project = <em>{shortProject(e.project)}</em>;
  switch (e.type) {
    case 'join': return <>{who} rolled onto the grid{e.km ? ` at ${km(e.km)} km` : ''}</>;
    case 'start': return <>{who} started {project}</>;
    case 'validate': return <>{who} validated {project}{e.grade !== undefined ? <> with <span className={(e.grade ?? 0) > 100 ? 'bonus' : ''}>{e.grade}</span></> : null}</>;
    case 'fail': return <>{who} spun out on {project}{e.grade ? ` (${e.grade})` : ''}</>;
    case 'overtake': return <>{who} passed {other}</>;
    case 'module': return <>{who} cleared <em>{e.module ? MODULE_BY_ID[e.module as keyof typeof MODULE_BY_ID]?.name : ''}</em></>;
    case 'finish': return <>{who} reached transcendence</>;
    case 'item': {
      const item = e.item ? ITEMS[e.item] : null;
      return e.other === e.player ? <>{who} used <em>{item?.name}</em></> : <>{who} hit {other} with <em>{item?.name}</em></>;
    }
    case 'blocked': return <>{who}&apos;s duck blocked {other}&apos;s <em>{e.item ? ITEMS[e.item].name : ''}</em></>;
    case 'shout': return <>{who}: <span className="shout">{e.text}</span></>;
  }
}

export function Feed() {
  const events = useStore((s) => s.events);
  const meId = useStore((s) => s.meId);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(true);
  const recent = events.slice(-30).reverse();

  const shout = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    send({ t: 'shout', text });
    setText('');
  };

  return (
    <section className={`feed ${open ? '' : 'collapsed'}`} aria-label="Race feed">
      <button className="feed-toggle pixel" onClick={() => setOpen(!open)} aria-expanded={open}>Race control</button>
      {open && (
        <>
          <ol>
            {recent.length === 0 && <li className="feed-empty">Nothing yet. Somebody has to go first.</li>}
            {recent.map((e) => (
              <li key={e.id} className={`feed-item ${e.type}`}>
                <p>{line(e)}<time>{ago(e.ts)}</time></p>
                {meId && (e.type === 'validate' || e.type === 'fail' || e.type === 'overtake' || e.type === 'item' || e.type === 'module') && (
                  <div className="reactions">
                    {REACTIONS.map((emoji) => {
                      const who = e.reactions?.[emoji] ?? [];
                      return (
                        <button key={emoji} className={`${who.length ? 'used' : ''} ${who.includes(meId) ? 'mine' : ''}`} onClick={() => send({ t: 'react', ev: e.id, emoji })} aria-label={`React ${emoji}`}>
                          {emoji}{who.length > 0 && <span>{who.length}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {meId && (
            <form onSubmit={shout}>
              <input value={text} maxLength={80} placeholder="Trash talk, 80 chars" aria-label="Say something" onChange={(e) => setText(e.target.value)} />
            </form>
          )}
        </>
      )}
    </section>
  );
}

/* ---- Banners ---- */

function bannerContent(e: RaceEvent): { kicker: string; title: ReactNode; sub?: ReactNode; tone: string } | null {
  const name = nameOf(e.player);
  switch (e.type) {
    case 'validate': {
      const p = e.project ? PROJECT_BY_ID[e.project] : null;
      const outstanding = (e.grade ?? 0) > 100;
      return { kicker: outstanding ? 'Outstanding' : 'Validated', title: name, sub: <>{p?.name.replace('Exam: ', '')} <b>{e.grade}</b> <span>+{p?.km} km</span></>, tone: outstanding ? 'gold' : 'ok' };
    }
    case 'fail':
      return { kicker: 'Spun out', title: name, sub: <>{shortProject(e.project)}{e.grade ? <> <b>{e.grade}</b></> : null}</>, tone: 'bad' };
    case 'overtake':
      return { kicker: 'Overtake', title: <>{name} <small>passes</small> {nameOf(e.other)}</>, tone: 'pink' };
    case 'module':
      return { kicker: 'Sector clear', title: name, sub: e.module ? MODULE_BY_ID[e.module as keyof typeof MODULE_BY_ID]?.name : '', tone: 'gold' };
    case 'finish':
      return { kicker: 'Transcended', title: name, sub: 'Common core complete', tone: 'gold' };
    case 'item': {
      if (!e.item) return null;
      const item = ITEMS[e.item];
      return { kicker: item.name, title: e.other === e.player ? name : <>{name} <small>hits</small> {nameOf(e.other)}</>, tone: 'pink' };
    }
    case 'blocked':
      return { kicker: 'Quack', title: <>{name} <small>blocks</small> {nameOf(e.other)}</>, tone: 'gold' };
    default:
      return null;
  }
}

export function Banners() {
  const banners = useStore((s) => s.banners);
  const current = banners[0];

  useEffect(() => {
    if (!current) return;
    const timer = window.setTimeout(() => setState({ banners: getState().banners.slice(1) }), 3600);
    return () => window.clearTimeout(timer);
  }, [current?.key]);

  if (!current) return null;
  const content = bannerContent(current.event);
  if (!content) return null;
  return (
    <div className={`banner ${content.tone}`} key={current.key} role="status">
      <span className="banner-kicker">{content.kicker}</span>
      <strong>{content.title}</strong>
      {content.sub && <p>{content.sub}</p>}
    </div>
  );
}

export function Toast() {
  const toastState = useStore((s) => s.toast);
  useEffect(() => {
    if (!toastState) return;
    const timer = window.setTimeout(() => setState({ toast: null }), 3400);
    return () => window.clearTimeout(timer);
  }, [toastState?.key]);
  return toastState ? <div className="toast" role="status" key={toastState.key}>{toastState.text}</div> : null;
}

/* ---- Item slot ---- */

const ROULETTE = Object.keys(ITEMS) as ItemId[];

export function ItemSlot() {
  const items = useStore((s) => s.items);
  const gained = useStore((s) => s.gained);
  const [spinning, setSpinning] = useState<ItemId | null>(null);
  const seen = useRef(gained?.key);

  useEffect(() => {
    if (!gained || gained.key === seen.current) return;
    seen.current = gained.key;
    sfx.item();
    let i = 0;
    const timer = window.setInterval(() => {
      i++;
      if (i > 12) {
        window.clearInterval(timer);
        setSpinning(null);
      } else setSpinning(ROULETTE[i % ROULETTE.length]);
    }, 90);
    return () => window.clearInterval(timer);
  }, [gained]);

  const item = spinning ?? items[0];
  const def = item ? ITEMS[item] : null;

  return (
    <button
      className={`action item-slot ${spinning ? 'spinning' : ''} ${item ? 'loaded' : ''}`}
      disabled={!item || !!spinning}
      title={def ? `${def.name}: ${def.text}` : 'Empty. Validate projects to earn items.'}
      aria-label={def ? `Use ${def.name}. ${def.text}` : 'Item slot, empty'}
      onClick={() => send({ t: 'item' })}
    >
      {item ? <ItemIcon item={item} size={26} /> : <span className="empty-slot" />}
      <span className="action-label">{def && !spinning ? def.name : 'Item'}</span>
      <span className="item-count" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i < items.length ? 'on' : ''} />)}</span>
    </button>
  );
}

/* ---- Top right ---- */

export function CameraBar({ mode, onMode }: { mode: CameraMode; onMode(m: CameraMode): void }) {
  const options: [CameraMode, string, ReactNode][] = [
    ['tour', 'TV', <Icon.Tv key="t" />],
    ['drone', 'Drone', <Icon.Drone key="d" />],
    ['follow', 'Chase', <Icon.Chase key="c" />],
  ];
  return (
    <div className="camera-bar" role="group" aria-label="Camera">
      {options.map(([m, label, icon]) => (
        <button key={m} className={mode === m ? 'on' : ''} onClick={() => onMode(m)} aria-pressed={mode === m} title={label}>
          {icon}<span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export function ExamChip({ onClick }: { onClick(): void }) {
  const exam = useStore((s) => s.room?.exam);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  if (!exam || exam.at < Date.now()) return null;
  return (
    <button className="exam-chip" onClick={onClick} title={`${exam.name}, ${new Date(exam.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}`}>
      <Icon.Trophy />
      <span className="pixel">Exam</span>
      <b>{countdown(exam.at - Date.now())}</b>
      {exam.place && <em>{exam.place}</em>}
    </button>
  );
}

const toLocalInput = (ts: number) => {
  const d = new Date(ts);
  return new Date(ts - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function Settings({ onClose, onGarage }: { onClose(): void; onGarage(): void }) {
  const room = useStore((s) => s.room);
  const meId = useStore((s) => s.meId);
  const [muted, setMuted] = useState(sfx.isMuted());
  const [examName, setExamName] = useState(room?.exam?.name ?? '');
  const [examAt, setExamAt] = useState(room?.exam ? toLocalInput(room.exam.at) : '');
  const [examPlace, setExamPlace] = useState(room?.exam?.place ?? '');
  const [deadline, setDeadline] = useState(room ? toLocalInput(room.paceEnd).slice(0, 10) : '');

  const saveExam = () => {
    send({ t: 'exam', exam: examAt ? { name: examName, at: new Date(examAt).getTime(), place: examPlace } : null });
    toast('Exam updated for everyone.');
  };
  const saveDeadline = () => {
    if (!deadline) return;
    send({ t: 'pace', end: new Date(deadline).getTime() });
    toast('The Black Hole has a new schedule.');
  };

  return (
    <aside className="popover" aria-label="Settings">
      <header>
        <h3>Race settings</h3>
        <button className="icon-btn small" onClick={onClose} aria-label="Close"><Icon.Close /></button>
      </header>
      <div className="popover-actions">
        <button className="btn" onClick={() => { const next = !muted; sfx.setMuted(next); setMuted(next); }}>
          {muted ? <Icon.Mute /> : <Icon.Sound />}{muted ? 'Sound off' : 'Sound on'}
        </button>
        <button className="btn" onClick={() => { onClose(); startReplay(); }}><Icon.Play />Season replay</button>
      </div>
      {meId && (
        <>
          <section>
            <h4 className="pixel">Next exam</h4>
            <input value={examName} maxLength={60} placeholder="Exam name" aria-label="Exam name" onChange={(e) => setExamName(e.target.value)} />
            <div className="field-row">
              <input type="datetime-local" value={examAt} aria-label="Exam date" onChange={(e) => setExamAt(e.target.value)} />
              <input className="short" value={examPlace} maxLength={20} placeholder="Room" aria-label="Exam room" onChange={(e) => setExamPlace(e.target.value)} />
            </div>
            <button className="btn" onClick={saveExam}>Save exam</button>
          </section>
          <section>
            <h4 className="pixel">Black Hole arrives</h4>
            <p className="hint">It reaches the finish on this date, moving at a steady pace from the day the race was created.</p>
            <div className="field-row">
              <input type="date" value={deadline} aria-label="Black Hole deadline" onChange={(e) => setDeadline(e.target.value)} />
              <button className="btn" onClick={saveDeadline}>Save</button>
            </div>
          </section>
          <div className="popover-actions">
            <button className="btn" onClick={() => { onClose(); onGarage(); }}><Icon.Wrench />Edit kart</button>
            <button className="link" onClick={() => { signOut(); onClose(); }}>Sign out here</button>
          </div>
        </>
      )}
    </aside>
  );
}

/* ---- While you were away ---- */

export function Away() {
  const awaySince = useStore((s) => s.awaySince);
  const events = useStore((s) => s.events);
  const meId = useStore((s) => s.meId);
  const [dismissed, setDismissed] = useState(false);

  const missed = useMemo(() => {
    if (!awaySince || Date.now() - awaySince < 30 * 60_000) return [];
    return events.filter((e) => e.ts > awaySince && e.player !== meId && e.type !== 'shout' && e.type !== 'start' && e.type !== 'join');
  }, [awaySince, events, meId]);

  if (dismissed || missed.length === 0) return null;
  const hits = events.filter((e) => e.ts > awaySince! && e.other === meId && e.type === 'item').length;

  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label="While you were away">
      <div className="modal away">
        <header className="modal-head">
          <div>
            <p className="pixel">Since {ago(awaySince!)} ago</p>
            <h2>While you were away</h2>
          </div>
          <button className="icon-btn" onClick={() => setDismissed(true)} aria-label="Close"><Icon.Close /></button>
        </header>
        {hits > 0 && <p className="away-hit">Your kart took {hits} {hits === 1 ? 'hit' : 'hits'}. Check the paintwork.</p>}
        <ol className="away-list">
          {missed.slice(-8).reverse().map((e) => <li key={e.id}>{line(e)}<time>{ago(e.ts)}</time></li>)}
        </ol>
        <div className="modal-actions">
          <button className="link" onClick={() => setDismissed(true)}>Skip</button>
          <button className="btn primary" onClick={() => { setDismissed(true); startReplay(); }}><Icon.Play />Watch the replay</button>
        </div>
      </div>
    </div>
  );
}

