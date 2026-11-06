import { MODULE_BY_ID, moduleCompletion, modulesProjects } from '../../../shared/curriculum.ts';
import type { ModuleId, Project } from '../../../shared/curriculum.ts';
import type { PlayerPublic } from '../../../shared/protocol.ts';
import { useStore } from '../store.ts';
import { Icon } from './Icons.tsx';

function Pip({ player, state }: { player: PlayerPublic; state: 'done' | 'wip' }) {
  return (
    <span className={`pip ${state}`} style={{ ['--paint' as string]: player.kart.paint }} title={`${player.name}: ${state === 'done' ? 'validated' : 'in progress'}`}>
      {player.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function Node({ project, players, me }: { project: Project; players: PlayerPublic[]; me?: PlayerPublic }) {
  const mine = me?.progress[project.id]?.s;
  const on = players.filter((p) => p.progress[project.id]?.s);
  return (
    <div className={`node ${mine ?? ''} ${project.kind}`}>
      <span className="node-name">
        {project.kind === 'exam' && <Icon.Trophy />}
        {project.name.replace('Exam: ', '')}
        {project.alt && <small>or {project.alt}</small>}
        {project.team && <Icon.Team />}
      </span>
      <span className="node-km">{project.km}</span>
      {on.length > 0 && (
        <span className="pips">
          {on.slice(0, 8).map((p) => <Pip key={p.id} player={p} state={p.progress[project.id].s!} />)}
          {on.length > 8 && <em>+{on.length - 8}</em>}
        </span>
      )}
    </div>
  );
}

function ModuleCard({ id, players, me }: { id: ModuleId; players: PlayerPublic[]; me?: PlayerPublic }) {
  const m = MODULE_BY_ID[id];
  const list = modulesProjects(id);
  const steps = list.filter((p) => p.kind === 'step');
  const main = list.filter((p) => p.kind !== 'step');
  const hours = list.filter((p) => p.kind !== 'exam').reduce((sum, p) => sum + p.km, 0);
  return (
    <section className="map-module" style={{ ['--sector' as string]: m.color }}>
      <header>
        <h3>{m.name}</h3>
        <span className="pixel">{hours}h</span>
        {me && <i style={{ width: `${moduleCompletion(id, me.progress) * 100}%` }} />}
      </header>
      {steps.length > 0 && (
        <details>
          <summary>Python Piscine, 11 steps</summary>
          <div className="nodes">{steps.map((p) => <Node key={p.id} project={p} players={players} me={me} />)}</div>
        </details>
      )}
      <div className="nodes">{main.map((p) => <Node key={p.id} project={p} players={players} me={me} />)}</div>
    </section>
  );
}

export function CurriculumMap({ onClose }: { onClose(): void }) {
  const players = useStore((s) => s.players);
  const me = useStore((s) => s.players.find((p) => p.id === s.meId));
  return (
    <div className="modal-wrap map-wrap" role="dialog" aria-modal="true" aria-label="Curriculum map">
      <div className="modal map">
        <header className="modal-head">
          <div>
            <p className="pixel">The real shape of the common core</p>
            <h2>Curriculum map</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon.Close /></button>
        </header>
        <p className="hint map-note">The track runs these modules end to end, but the branches below can be done in any order. Your kart only counts distance, so the order is up to you.</p>
        <div className="map-grid">
          <div className="map-col"><ModuleCard id="fund" players={players} me={me} /></div>
          <div className="map-col"><ModuleCard id="oop" players={players} me={me} /><ModuleCard id="admin" players={players} me={me} /></div>
          <div className="map-col"><ModuleCard id="algo" players={players} me={me} /><ModuleCard id="ai" players={players} me={me} /><ModuleCard id="net" players={players} me={me} /></div>
          <div className="map-col"><ModuleCard id="web" players={players} me={me} /></div>
        </div>
      </div>
    </div>
  );
}
