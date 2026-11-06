import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  MODULES, PROJECT_BY_ID, ancestorsOf, modulesProjects,
} from '../../../shared/curriculum.ts';
import { BODIES, DEFAULT_KART, DRIVERS, LOGIN_RE, PAINTS, PIN_RE } from '../../../shared/protocol.ts';
import type { KartConfig } from '../../../shared/protocol.ts';
import { Turntable } from '../game/world.ts';
import { km } from '../format.ts';
import { getState, joinRace, playerById, reclaimKart, send } from '../store.ts';
import { Icon } from './Icons.tsx';

function KartPreview({ kart }: { kart: KartConfig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const table = useRef<Turntable | null>(null);

  useEffect(() => {
    const t = new Turntable(ref.current!);
    table.current = t;
    return () => {
      t.dispose();
      table.current = null;
    };
  }, []);

  useEffect(() => table.current?.setKart(kart), [kart]);

  return <canvas ref={ref} className="turntable" aria-label="Your kart, drag to rotate" />;
}

function KartEditor({ kart, onChange }: { kart: KartConfig; onChange(k: KartConfig): void }) {
  const set = (patch: Partial<KartConfig>) => onChange({ ...kart, ...patch });
  return (
    <div className="kart-editor">
      <fieldset>
        <legend className="pixel">Chassis</legend>
        <div className="choice-list">
          {BODIES.map((b) => (
            <button key={b.id} type="button" className={`choice ${kart.body === b.id ? 'on' : ''}`} aria-pressed={kart.body === b.id} onClick={() => set({ body: b.id })}>
              <b>{b.name}</b><small>{b.note}</small>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="pixel">Driver</legend>
        <div className="chips">
          {DRIVERS.map((d) => (
            <button key={d.id} type="button" className={`chip ${kart.driver === d.id ? 'on' : ''}`} aria-pressed={kart.driver === d.id} onClick={() => set({ driver: d.id })}>{d.name}</button>
          ))}
        </div>
      </fieldset>
      <div className="paint-row">
        <fieldset>
          <legend className="pixel">Paint</legend>
          <div className="swatches">
            {PAINTS.map((c) => (
              <button key={c} type="button" aria-label={`Paint ${c}`} aria-pressed={kart.paint === c} className={kart.paint === c ? 'on' : ''} style={{ background: c }} onClick={() => set({ paint: c })} />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="pixel">Accent</legend>
          <div className="swatches">
            {PAINTS.map((c) => (
              <button key={c} type="button" aria-label={`Accent ${c}`} aria-pressed={kart.accent === c} className={kart.accent === c ? 'on' : ''} style={{ background: c }} onClick={() => set({ accent: c })} />
            ))}
          </div>
        </fieldset>
      </div>
      <label className="number-field">
        <span className="pixel">Race number</span>
        <input type="number" min={0} max={99} value={kart.number} onChange={(e) => set({ number: Math.min(99, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} />
      </label>
    </div>
  );
}

function GridPicker({ done, onChange }: { done: Set<string>; onChange(next: Set<string>): void }) {
  const toggle = (id: string) => {
    const next = new Set(done);
    if (next.has(id)) next.delete(id);
    else {
      next.add(id);
      // Ticking a project implies everything needed to reach it.
      for (const a of ancestorsOf(id)) next.add(a);
    }
    onChange(next);
  };
  const total = [...done].reduce((sum, id) => sum + PROJECT_BY_ID[id].km, 0);

  return (
    <div className="grid-picker">
      <p className="hint">Tap the last thing you validated and everything before it fills in. Starting from zero is fine too.</p>
      <div className="grid-modules">
        {MODULES.map((m) => (
          <section key={m.id} style={{ ['--sector' as string]: m.color }}>
            <h4>{m.name}</h4>
            <div className="chips">
              {modulesProjects(m.id).filter((p) => p.module === m.id).map((p) => (
                <button key={p.id} type="button" className={`chip ${done.has(p.id) ? 'done' : ''}`} aria-pressed={done.has(p.id)} onClick={() => toggle(p.id)}>
                  {p.name.replace('Exam: ', 'Exam ')}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <p className="grid-total"><span className="pixel">You start at</span> <b>{km(total)} km</b></p>
    </div>
  );
}

type Step = 'driver' | 'kart' | 'grid' | 'reclaim';

export function Garage({ room, edit, onClose }: { room: string; edit?: boolean; onClose(): void }) {
  const me = edit ? playerById(getState().meId ?? undefined) : undefined;
  const [step, setStep] = useState<Step>(edit ? 'kart' : 'driver');
  const [login, setLogin] = useState('');
  const [name, setName] = useState(me?.name ?? '');
  const [pin, setPin] = useState('');
  const [kart, setKart] = useState<KartConfig>(() => me?.kart ?? {
    ...DEFAULT_KART,
    paint: PAINTS[Math.floor(Math.random() * 8)],
    number: Math.floor(Math.random() * 99) + 1,
  });
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const driverValid = useMemo(() => LOGIN_RE.test(login) && PIN_RE.test(pin), [login, pin]);

  const submitDriver = (e: FormEvent) => {
    e.preventDefault();
    if (getState().players.some((p) => p.login === login)) {
      setError('That login is already on the grid. If it is you, use your PIN below.');
      return;
    }
    setError('');
    setStep('kart');
  };

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      await joinRace(room, { login, name, pin, kart, done: [...done] });
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const reclaim = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await reclaimKart(room, login, pin);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const saveEdit = () => {
    send({ t: 'kart', kart, name });
    onClose();
  };

  const title = edit ? 'Back in the garage' : step === 'reclaim' ? 'Welcome back' : step === 'driver' ? 'Driver license' : step === 'kart' ? 'Build your kart' : 'Starting position';

  return (
    <div className="modal-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal garage step-${step}`}>
        <header className="modal-head">
          <div>
            {!edit && step !== 'reclaim' && <p className="pixel">Step {step === 'driver' ? 1 : step === 'kart' ? 2 : 3} of 3</p>}
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon.Close /></button>
        </header>

        {step === 'driver' && (
          <form className="stack" onSubmit={submitDriver}>
            <label>
              <span className="pixel">42 login</span>
              <input autoFocus value={login} maxLength={16} autoCapitalize="none" spellCheck={false} placeholder="nfavier" onChange={(e) => setLogin(e.target.value.toLowerCase())} />
            </label>
            <label>
              <span className="pixel">Name on the kart</span>
              <input value={name} maxLength={20} placeholder={login || 'Noam'} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <span className="pixel">PIN</span>
              <input type="password" inputMode="numeric" value={pin} maxLength={8} placeholder="4 to 8 digits" autoComplete="new-password" onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
              <small className="hint">This is how you get your kart back on the cluster or your phone. Not your intra password.</small>
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="link" onClick={() => { setError(''); setStep('reclaim'); }}>I already have a kart</button>
              <button className="btn primary" disabled={!driverValid}>Next</button>
            </div>
          </form>
        )}

        {step === 'reclaim' && (
          <form className="stack" onSubmit={reclaim}>
            <label>
              <span className="pixel">42 login</span>
              <input autoFocus value={login} maxLength={16} autoCapitalize="none" spellCheck={false} onChange={(e) => setLogin(e.target.value.toLowerCase())} />
            </label>
            <label>
              <span className="pixel">PIN</span>
              <input type="password" inputMode="numeric" value={pin} maxLength={8} autoComplete="current-password" onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions">
              <button type="button" className="link" onClick={() => { setError(''); setStep('driver'); }}>New driver</button>
              <button className="btn primary" disabled={busy || !driverValid}>Get my kart</button>
            </div>
          </form>
        )}

        {step === 'kart' && (
          <div className="kart-step">
            <div className="preview-col">
              <KartPreview kart={kart} />
              {edit && (
                <label className="edit-name">
                  <span className="pixel">Name on the kart</span>
                  <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
                </label>
              )}
            </div>
            <KartEditor kart={kart} onChange={setKart} />
            <div className="modal-actions full">
              {edit ? (
                <>
                  <span />
                  <button className="btn primary" onClick={saveEdit}>Save kart</button>
                </>
              ) : (
                <>
                  <button className="link" onClick={() => setStep('driver')}>Back</button>
                  <button className="btn primary" onClick={() => setStep('grid')}>Next</button>
                </>
              )}
            </div>
          </div>
        )}

        {step === 'grid' && (
          <>
            <GridPicker done={done} onChange={setDone} />
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions">
              <button className="link" onClick={() => setStep('kart')}>Back</button>
              <button className="btn primary" disabled={busy} onClick={finish}>{busy ? 'Rolling out' : 'Hit the track'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

