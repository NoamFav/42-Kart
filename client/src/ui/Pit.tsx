import { useState } from 'react';
import {
  MAX_GRADE, MAX_WIP_PCT, MODULES, PROJECT_BY_ID, isUnlocked, moduleCompletion, modulesProjects,
} from '../../../shared/curriculum.ts';
import type { Progress, Project } from '../../../shared/curriculum.ts';
import { send, useStore } from '../store.ts';
import { sfx } from '../audio.ts';
import { Icon } from './Icons.tsx';

function GradeControl({ onConfirm, onCancel, label, tone }: { onConfirm(grade: number): void; onCancel(): void; label: string; tone: 'ok' | 'bad' }) {
  const [grade, setGrade] = useState(tone === 'ok' ? 100 : 0);
  const presets = tone === 'ok' ? [100, 110, 125] : [0, 25, 50];
  return (
    <div className="grade-control">
      <div className="grade-input">
        <label>
          <span className="pixel">Grade</span>
          <input type="number" min={0} max={MAX_GRADE} value={grade} onChange={(e) => setGrade(Math.max(0, Math.min(MAX_GRADE, Number(e.target.value) || 0)))} />
        </label>
        {presets.map((g) => (
          <button key={g} type="button" className={`chip ${grade === g ? 'on' : ''}`} onClick={() => setGrade(g)}>{g}</button>
        ))}
      </div>
      {tone === 'ok' && grade > 100 && <p className="hint">Outstanding. Bonus points feed the tiebreak{grade >= 110 ? ', and this one pays two item boxes.' : '.'}</p>}
      <div className="row-actions">
        <button className="link" onClick={onCancel}>Cancel</button>
        <button className={`btn ${tone === 'ok' ? 'go' : 'danger'}`} onClick={() => onConfirm(grade)}>{label}</button>
      </div>
    </div>
  );
}

function ProjectRow({ project, progress, open, onToggle }: { project: Project; progress: Progress; open: boolean; onToggle(): void }) {
  const st = progress[project.id];
  const [draft, setDraft] = useState<number | null>(null);
  const pct = draft ?? st?.p ?? 0;
  const [form, setForm] = useState<'validate' | 'fail' | null>(null);
  const unlocked = isUnlocked(project, progress);
  const state = st?.s === 'done' ? 'done' : st?.s === 'wip' ? 'wip' : unlocked ? 'open' : 'locked';
  const missing = project.requires.filter((r) => progress[r]?.s !== 'done').map((r) => PROJECT_BY_ID[r].name);

  const act = (action: 'none' | 'wip' | 'done' | 'fail', extra: { pct?: number; grade?: number } = {}) => {
    send({ t: 'project', id: project.id, action, ...extra });
    setForm(null);
  };

  const commitPct = () => {
    if (draft === null) return;
    act('wip', { pct: draft });
    setDraft(null);
  };

  return (
    <li className={`project ${state} ${project.kind}`}>
      <button className="project-head" aria-expanded={open} onClick={() => { sfx.tick(); onToggle(); }}>
        <span className="project-name">
          {project.kind === 'exam' && <span className="exam-mark"><Icon.Trophy /></span>}
          {project.name.replace('Exam: ', '')}
          {project.alt && <small> or {project.alt}</small>}
        </span>
        {project.team && <span className="team" title="Group project"><Icon.Team /></span>}
        <span className="project-km">{project.km} km</span>
        <span className="project-state">
          {state === 'done' ? <><b>{st?.g}</b><Icon.Check /></> : state === 'wip' ? <><b>{st?.p}%</b><Icon.Hourglass /></> : state === 'locked' ? <Icon.Lock /> : null}
        </span>
      </button>
      {state === 'wip' && <div className="project-bar"><i style={{ width: `${((st?.p ?? 0) / MAX_WIP_PCT) * 100}%` }} /></div>}

      {open && (
        <div className="project-body">
          {state === 'locked' && missing.length > 0 && (
            <p className="hint">Locked on the portal until {missing.slice(0, 2).join(' and ')}{missing.length > 2 ? ` and ${missing.length - 2} more` : ''}. You can still log it if the portal says otherwise.</p>
          )}
          {!!st?.f && <p className="hint">{st.f} failed {st.f === 1 ? 'attempt' : 'attempts'} so far.</p>}

          {form === 'validate' && <GradeControl label="Validated" tone="ok" onCancel={() => setForm(null)} onConfirm={(grade) => act('done', { grade })} />}
          {form === 'fail' && <GradeControl label="Log the crash" tone="bad" onCancel={() => setForm(null)} onConfirm={(grade) => act('fail', { grade })} />}

          {!form && state !== 'done' && (
            <>
              {st?.s === 'wip' || project.kind === 'exam' ? null : (
                <button className="btn wide" onClick={() => act('wip', { pct: 5 })}>Start this project</button>
              )}
              {st?.s === 'wip' && (
                <label className="slider">
                  <span><span className="pixel">How far along</span><b>{pct}%</b></span>
                  <input
                    type="range" min={0} max={MAX_WIP_PCT} step={5} value={pct}
                    onChange={(e) => setDraft(Number(e.target.value))}
                    onPointerUp={commitPct}
                    onKeyUp={commitPct}
                  />
                  <small className="hint">Capped at {MAX_WIP_PCT}%. The last stretch only opens with a validation.</small>
                </label>
              )}
              <div className="row-actions">
                <button className="btn danger" onClick={() => setForm('fail')}>Failed</button>
                <button className="btn go" onClick={() => setForm('validate')}>Validated</button>
              </div>
              {st?.s === 'wip' && <button className="link" onClick={() => act('none')}>Not actually on this</button>}
            </>
          )}

          {!form && state === 'done' && (
            <div className="row-actions">
              <button className="link" onClick={() => act('none')}>Undo validation</button>
              <button className="btn" onClick={() => setForm('validate')}>Change grade</button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function Pit({ onClose }: { onClose(): void }) {
  const me = useStore((s) => s.players.find((p) => p.id === s.meId));
  const firstOpen = me ? MODULES.find((m) => moduleCompletion(m.id, me.progress) < 1)?.id : undefined;
  const [module, setModule] = useState<string | null>(firstOpen ?? 'fund');
  const [openProject, setOpenProject] = useState<string | null>(null);
  if (!me) return null;

  return (
    <aside className="drawer" aria-label="Your projects">
      <header className="drawer-head">
        <div>
          <p className="pixel">Pit lane</p>
          <h2>Your projects</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon.Close /></button>
      </header>
      <div className="drawer-scroll">
        {MODULES.map((m) => {
          const done = moduleCompletion(m.id, me.progress);
          const open = module === m.id;
          const list = modulesProjects(m.id);
          const steps = list.filter((p) => p.kind === 'step');
          const others = list.filter((p) => p.kind !== 'step');
          const row = (p: Project) => (
            <ProjectRow
              key={p.id} project={p} progress={me.progress}
              open={openProject === p.id}
              onToggle={() => setOpenProject(openProject === p.id ? null : p.id)}
            />
          );
          return (
            <section key={m.id} className="pit-module" style={{ ['--sector' as string]: m.color }}>
              <button className="pit-module-head" aria-expanded={open} onClick={() => setModule(open ? null : m.id)}>
                <span>
                  <b>{m.name}</b>
                  <small className="pixel">{m.sector}</small>
                </span>
                <span className="pit-pct">{Math.round(done * 100)}%</span>
                <i style={{ width: `${done * 100}%` }} />
              </button>
              {open && (
                <>
                  {steps.length > 0 && (
                    <>
                      <h3 className="pixel sub">Python Piscine, 70 km</h3>
                      <ul className="projects">{steps.map(row)}</ul>
                      <h3 className="pixel sub">Then</h3>
                    </>
                  )}
                  <ul className="projects">{others.map(row)}</ul>
                </>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
