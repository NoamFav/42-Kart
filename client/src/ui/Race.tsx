import { useCallback, useEffect, useRef, useState } from 'react';
import { SECTORS, TOTAL_KM } from '../../../shared/curriculum.ts';
import { sfx } from '../audio.ts';
import { lapTime } from '../format.ts';
import type { CameraMode } from '../game/world.ts';
import { world } from '../stage.ts';
import { connect, disconnect, getState, send, setState, toast, useStore } from '../store.ts';
import { CurriculumMap } from './CurriculumMap.tsx';
import { DriveHud } from './DriveHud.tsx';
import { Garage } from './Garage.tsx';
import { Away, Banners, CameraBar, ExamChip, Feed, ItemSlot, Settings, Strip, Toast, Tower, paceKm } from './Hud.tsx';
import { Icon } from './Icons.tsx';
import { Pit } from './Pit.tsx';

type Panel = 'pit' | 'map' | 'settings' | 'garage' | 'editKart' | null;

export function Race({ code, go, cameraMode }: { code: string; go(path: string): void; cameraMode: CameraMode }) {
  const status = useStore((s) => s.status);
  const room = useStore((s) => s.room);
  const meId = useStore((s) => s.meId);
  const playerCount = useStore((s) => s.players.length);
  const replaying = useStore((s) => s.replay !== null);
  const [panel, setPanel] = useState<Panel>(null);
  const [driving, setDriving] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const introDone = useRef(false);

  useEffect(() => {
    introDone.current = false;
    connect(code);
    const w = world();
    w?.setMode('drone');
    return () => {
      disconnect();
      setState({ status: 'idle' });
      world()?.setPace(null);
    };
  }, [code]);

  // Open on the whole circuit, then dive to the action.
  useEffect(() => {
    if (status !== 'open' || introDone.current || playerCount === 0) return;
    introDone.current = true;
    const timer = window.setTimeout(() => {
      const w = world();
      if (w && w.mode === 'drone' && !getState().replay) w.setMode('tour', getState().meId ?? undefined);
    }, 3800);
    return () => window.clearTimeout(timer);
  }, [status, playerCount]);

  useEffect(() => {
    const update = () => {
      if (room) world()?.setPace(paceKm(room.paceStart, room.paceEnd, Date.now()));
    };
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, [room]);

  const onFocus = useCallback((id: string) => {
    const w = world();
    if (!w) return;
    setFocus(id);
    if (w.mode === 'drive') return;
    w.setMode(w.mode === 'drone' ? 'follow' : w.mode, id);
  }, []);

  const startDrive = useCallback(() => {
    const w = world();
    const state = getState();
    const me = state.players.find((p) => p.id === state.meId);
    if (!w || !me) return;
    setPanel(null);
    setDriving(true);
    const frontier = Math.min(TOTAL_KM, Math.max(SECTORS[0].end, me.km + 40));
    let wallAt = 0;
    w.startDrive(frontier, {
      onBarrier() {
        sfx.barrier();
        toast('Road closed. Validate more projects to open it.');
      },
      onWall(speed) {
        const now = performance.now();
        if (speed > 12 && now - wallAt > 180) {
          wallAt = now;
          sfx.wall();
        }
      },
      onBoost: () => sfx.boost(),
      onSector(sector, ms) {
        send({ t: 'time', sector, ms });
        toast(`${SECTORS[sector].sector}: ${lapTime(ms)}`);
      },
    });
    let sentAt = 0;
    w.onDriveSample = (d) => {
      sfx.engine(d.speed);
      const now = performance.now();
      if (now - sentAt < 80) return;
      sentAt = now;
      send({ t: 'live', s: d.s, l: d.lat, h: d.heading, v: d.speed, d: d.drifting ? 1 : 0 });
    };
  }, []);

  const stopDrive = useCallback(() => {
    const w = world();
    if (!w) return;
    w.onDriveSample = null;
    w.stopDrive();
    sfx.engineStop();
    send({ t: 'liveEnd' });
    setDriving(false);
  }, []);

  const honk = useCallback(() => {
    send({ t: 'honk' });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (driving || e.metaKey || e.ctrlKey || (e.target as HTMLElement).closest('input, textarea, select')) return;
      const key = e.key.toLowerCase();
      if (key === 'escape') setPanel(null);
      if (key === 'm') setPanel((p) => (p === 'map' ? null : 'map'));
      if (meId) {
        if (key === 'p') setPanel((p) => (p === 'pit' ? null : 'pit'));
        if (key === 'h') honk();
        if (key === 'i') send({ t: 'item' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [driving, meId, honk]);

  if (status === 'missing') {
    return (
      <main className="center-note">
        <h1>No race here</h1>
        <p>The code <code>{code}</code> does not match any race. Check the link, or start your own.</p>
        <button className="btn primary" onClick={() => go('/')}>Back to the start</button>
      </main>
    );
  }

  const setCamera = (mode: CameraMode) => {
    const w = world();
    if (!w) return;
    w.setMode(mode, mode === 'drone' ? undefined : (w.focusId ?? meId ?? undefined));
  };

  return (
    <div className={`hud ${driving ? 'driving' : ''} ${panel === 'pit' ? 'pit-open' : ''}`}>
      {status === 'lost' && <div className="reconnecting pixel" role="status">Reconnecting</div>}

      {!driving && (
        <>
          <Tower focus={focus} onFocus={onFocus} />
          <div className="top-right">
            <ExamChip onClick={() => setPanel('settings')} />
            <CameraBar mode={cameraMode} onMode={setCamera} />
            <button className="icon-btn" onClick={() => setPanel(panel === 'settings' ? null : 'settings')} aria-label="Settings"><Icon.Gear /></button>
          </div>
          {panel !== 'pit' && <Feed />}
          <Strip onFocus={onFocus} />

          <div className="actions">
            <button className="action" onClick={() => setPanel('map')} title="Curriculum map (M)">
              <Icon.Map /><span className="action-label">Map</span>
            </button>
            {meId ? (
              <>
                <ItemSlot />
                <button className="action" onClick={honk} title="Honk (H)"><Icon.Horn /><span className="action-label">Honk</span></button>
                <button className="action" onClick={startDrive} disabled={replaying} title="Drive your unlocked track, live with whoever is online">
                  <Icon.Wheel /><span className="action-label">Drive</span>
                </button>
                <button className="btn primary pit-btn" onClick={() => setPanel(panel === 'pit' ? null : 'pit')} title="Your projects (P)">
                  <Icon.Wrench />Pit
                </button>
              </>
            ) : (
              status === 'open' && <button className="btn primary pit-btn" onClick={() => setPanel('garage')}>Join the race</button>
            )}
          </div>

          {status === 'open' && playerCount === 0 && panel === null && (
            <div className="empty-grid">
              <p className="pixel">Empty grid</p>
              <h2>Be first on the track</h2>
              <p>Build your kart, then send the link to the rest of the cluster.</p>
              <button className="btn primary" onClick={() => setPanel('garage')}>Build my kart</button>
            </div>
          )}
        </>
      )}

      {driving && <DriveHud onExit={stopDrive} />}

      <Banners />
      <Toast />

      {panel === 'pit' && <Pit onClose={() => setPanel(null)} />}
      {panel === 'map' && <CurriculumMap onClose={() => setPanel(null)} />}
      {panel === 'settings' && <Settings onClose={() => setPanel(null)} onGarage={() => setPanel('editKart')} />}
      {panel === 'garage' && <Garage room={code} onClose={() => setPanel(null)} />}
      {panel === 'editKart' && <Garage room={code} edit onClose={() => setPanel(null)} />}
      {panel === null && !driving && <Away />}
    </div>
  );
}
