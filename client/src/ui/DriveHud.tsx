import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { SECTORS, sectorAt } from '../../../shared/curriculum.ts';
import { lapTime } from '../format.ts';
import { track } from '../game/track.ts';
import { world } from '../stage.ts';
import { useStore } from '../store.ts';

function HotLaps() {
  const times = useStore((s) => s.times);
  const players = useStore((s) => s.players);
  const meId = useStore((s) => s.meId);
  const best = SECTORS.flatMap((sec) => {
    const list = times.filter((t) => t.sector === sec.index).sort((a, b) => a.ms - b.ms);
    return list[0] ? [{ sec, top: list[0], mine: list.find((t) => t.player === meId) }] : [];
  });
  if (!best.length) return null;
  return (
    <aside className="hot-laps" aria-label="Best sector times">
      <h3 className="pixel">Sector records</h3>
      <ol>
        {best.map(({ sec, top, mine }) => (
          <li key={sec.id}>
            <span style={{ color: sec.color }}>{sec.sector}</span>
            <b>{lapTime(top.ms)}</b>
            <small>{players.find((p) => p.id === top.player)?.name}</small>
            {mine && mine !== top && <em>you {lapTime(mine.ms)}</em>}
          </li>
        ))}
      </ol>
    </aside>
  );
}

const touchDevice = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

export function DriveHud({ onExit }: { onExit(): void }) {
  const speedRef = useRef<HTMLElement>(null);
  const timerRef = useRef<HTMLElement>(null);
  const boostRef = useRef<HTMLElement>(null);
  const [sector, setSector] = useState(SECTORS[0].sector);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const d = world()?.driver;
      if (!d) return;
      if (speedRef.current) speedRef.current.textContent = String(Math.round(Math.abs(d.speed) * 2.1));
      const elapsed = d.sectorElapsed();
      if (timerRef.current) timerRef.current.textContent = elapsed !== null ? lapTime(elapsed) : '--:--';
      if (boostRef.current) boostRef.current.style.transform = `scaleX(${Math.min(1, d.boost > 0 ? 1 : d.driftCharge / 0.7)})`;
      const name = sectorAt(Math.max(track.kmOf(d.s), 0)).sector;
      setSector((current) => (current === name ? current : name));
    };
    tick();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', esc);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', esc);
    };
  }, [onExit]);

  useEffect(() => {
    if (!touchDevice) return;
    const d = world()?.driver;
    if (d) d.input.throttle = true;
  }, []);

  const hold = (key: 'left' | 'right' | 'brake' | 'drift') => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      const d = world()?.driver;
      if (d) d.input[key] = true;
    },
    onPointerUp: () => {
      const d = world()?.driver;
      if (d) d.input[key] = false;
    },
    onPointerLeave: () => {
      const d = world()?.driver;
      if (d) d.input[key] = false;
    },
  });

  return (
    <div className="drive-hud">
      <div className="drive-top">
        <span className="pixel">{sector}</span>
        <b ref={timerRef}>--:--</b>
      </div>
      <HotLaps />
      <div className="speedo">
        <b ref={speedRef}>0</b>
        <span className="pixel">km/h</span>
        <div className="boost-bar"><i ref={boostRef} /></div>
      </div>
      <div className="drive-help">
        <p className="pixel keys">WASD or arrows. Space drifts. Your validated gates are boost pads.</p>
        <button className="btn" onClick={onExit}>Leave the track</button>
      </div>
      {touchDevice && (
        <div className="touch-pad">
          <div>
            <button aria-label="Steer left" {...hold('left')}>◀</button>
            <button aria-label="Steer right" {...hold('right')}>▶</button>
          </div>
          <div>
            <button aria-label="Brake" {...hold('brake')}>Brake</button>
            <button aria-label="Drift" {...hold('drift')}>Drift</button>
          </div>
        </div>
      )}
    </div>
  );
}

