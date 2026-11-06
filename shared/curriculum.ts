/**
 * The 42 common core as a race course.
 *
 * 1 km of track = 1 estimated hour of work, taken from the curriculum slide.
 * Exams have no hours on the slide, so their distance is our own call (EXAM_KM).
 * Projects are listed in track order; `start` / `end` are computed below.
 */

export type ModuleId = 'fund' | 'oop' | 'admin' | 'algo' | 'ai' | 'net' | 'web';

export interface Module {
  id: ModuleId;
  name: string;
  /** Race-flavoured name of this stretch of track. */
  sector: string;
  color: string;
  blurb: string;
}

export interface Project {
  id: string;
  name: string;
  /** Second way to complete the same slot, shown as "or ...". */
  alt?: string;
  km: number;
  module: ModuleId;
  /** Other modules that also list this project (push_swap). */
  alsoIn?: ModuleId[];
  kind: 'project' | 'exam' | 'step';
  team?: boolean;
  requires: string[];
  /** Filled in at load: distance along the track. */
  start: number;
  end: number;
}

export const MODULES: Module[] = [
  { id: 'fund', name: 'Programming Fundamentals', sector: 'Malloc Mile', color: '#2ee6c5', blurb: 'C from the ground up. Every byte is yours to lose.' },
  { id: 'oop', name: 'Object Oriented Programming', sector: 'Serpent Gardens', color: '#8be04e', blurb: 'Python, classes and a maze with a mind of its own.' },
  { id: 'admin', name: 'Systems & Networks Administration', sector: 'Root Canyon', color: '#ffb02e', blurb: 'Racks, subnets and containers all the way down.' },
  { id: 'algo', name: 'Algorithmics', sector: 'Big-O Bend', color: '#ff4fa3', blurb: 'Sort the stacks. Take the racing line.' },
  { id: 'ai', name: 'Artificial Intelligence', sector: 'Agent Alley', color: '#a47bff', blurb: 'The track starts driving back.' },
  { id: 'net', name: 'System & Network Programming', sector: 'Packet Pass', color: '#3fa9ff', blurb: 'Threads, sockets and a very long pit lane.' },
  { id: 'web', name: 'Web Programming', sector: 'Transcendence', color: '#ffe08a', blurb: 'One last climb. Bring your team.' },
];

const P = (
  id: string,
  name: string,
  km: number,
  module: ModuleId,
  requires: string[],
  extra: Partial<Project> = {},
): Project => ({ id, name, km, module, requires, kind: 'project', start: 0, end: 0, ...extra });

const step = (id: string, name: string, km: number, requires: string[]) =>
  P(id, name, km, 'oop', requires, { kind: 'step' });

const exam = (id: string, name: string, km: number, module: ModuleId, requires: string[]) =>
  P(id, name, km, module, requires, { kind: 'exam' });

export const PROJECTS: Project[] = [
  // Programming Fundamentals, 240h + exam
  P('libft', 'Libft', 70, 'fund', []),
  P('ft_printf', 'ft_printf', 55, 'fund', ['libft']),
  P('get_next_line', 'get_next_line', 45, 'fund', ['libft']),
  P('push_swap', 'push_swap', 70, 'fund', ['ft_printf', 'get_next_line'], { team: true, alsoIn: ['algo'] }),
  exam('exam_fund', 'Exam: Programming Fundamentals', 20, 'fund', ['push_swap']),

  // Object Oriented Programming, 270h + exam. Python Piscine (70h) split over its 11 steps.
  step('growing_code', 'Growing Code', 4, ['push_swap']),
  step('code_cultivation', 'CodeCultivation', 5, ['growing_code']),
  step('garden_guardian', 'Garden Guardian', 6, ['code_cultivation']),
  step('data_quest', 'Data Quest', 6, ['garden_guardian']),
  step('data_archivist', 'Data Archivist', 6, ['garden_guardian']),
  step('code_nexus', 'Code Nexus', 7, ['garden_guardian']),
  step('the_codex', 'The Codex', 7, ['garden_guardian']),
  step('data_deck', 'DataDeck', 7, ['data_quest', 'data_archivist', 'code_nexus', 'the_codex']),
  step('the_matrix', 'The Matrix', 7, ['data_quest', 'data_archivist', 'code_nexus', 'the_codex']),
  step('cosmic_data', 'Cosmic Data', 7, ['data_quest', 'data_archivist', 'code_nexus', 'the_codex']),
  step('func_mage', 'FuncMage', 8, ['data_quest', 'data_archivist', 'code_nexus', 'the_codex']),
  P('a_maze_ing', 'A-Maze-ing', 50, 'oop', ['data_deck', 'the_matrix', 'cosmic_data', 'func_mage'], { team: true }),
  P('pac_man', 'Pac-Man', 150, 'oop', ['a_maze_ing'], { team: true }),
  exam('exam_oop', 'Exam: Medium Python Algorithms', 30, 'oop', ['pac_man']),

  // Systems & Networks Administration, 250h + exam
  P('born2beroot', 'Born2beRoot', 50, 'admin', ['push_swap']),
  P('netpractice', 'NetPractice', 50, 'admin', ['born2beroot']),
  P('inception', 'Inception', 150, 'admin', ['netpractice']),
  exam('exam_admin', 'Exam: Basic Python Algorithms', 20, 'admin', ['inception']),

  // Algorithmics, 190h on the slide, but its push_swap is the one above: counted once.
  P('fly_in', 'Fly-in', 120, 'algo', ['pac_man', 'inception']),
  exam('exam_algo', 'Exam: Challenging Python Algorithms', 40, 'algo', ['fly_in']),

  // Artificial Intelligence, 330h. Agent Smith and free_rify share one 100h slot.
  P('call_me_maybe', 'Call Me Maybe', 80, 'ai', ['pac_man', 'inception']),
  P('rag', 'RAG Against The Machine', 150, 'ai', ['call_me_maybe']),
  P('agent_smith', 'Agent Smith', 100, 'ai', ['rag'], { alt: 'free_rify' }),

  // System & Network Programming. Boxes add up to 220h although the slide header says 230h.
  P('codexion', 'Codexion', 70, 'net', ['pac_man', 'inception']),
  P('answer_protocol', 'The Answer Protocol', 150, 'net', ['codexion'], { team: true }),
  exam('exam_net', 'Exam: In-Depth Python Algorithms', 50, 'net', ['answer_protocol']),

  // Web Programming, 280h
  P('ft_transcendence', 'ft_transcendence', 280, 'web', ['fly_in', 'agent_smith', 'answer_protocol'], { team: true }),
];

let cursor = 0;
for (const p of PROJECTS) {
  p.start = cursor;
  cursor += p.km;
  p.end = cursor;
}

/** Full race distance in km. */
export const TOTAL_KM = cursor;

export const PROJECT_BY_ID: Record<string, Project> = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));
export const MODULE_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<ModuleId, Module>;

export interface Sector extends Module {
  start: number;
  end: number;
  index: number;
}

/** Each module's stretch of track. */
export const SECTORS: Sector[] = MODULES.map((m, index) => {
  const own = PROJECTS.filter((p) => p.module === m.id);
  return { ...m, index, start: own[0].start, end: own[own.length - 1].end };
});

export function sectorAt(km: number): Sector {
  return SECTORS.find((s) => km < s.end) ?? SECTORS[SECTORS.length - 1];
}

export function modulesProjects(id: ModuleId): Project[] {
  return PROJECTS.filter((p) => p.module === id || p.alsoIn?.includes(id));
}

export type ProjectStatus = 'wip' | 'done';

export interface ProjectState {
  /** Omitted when the project has only recorded failed attempts. */
  s?: ProjectStatus;
  /** Self-reported completion while in progress. */
  p?: number;
  /** Validated grade, 0 to 125. */
  g?: number;
  /** Failed attempts so far. */
  f?: number;
}

export type Progress = Record<string, ProjectState>;

/** Work in progress moves you, but the last stretch of a project only opens with a validation. */
export const MAX_WIP_PCT = 90;
export const MAX_GRADE = 125;

export function projectFraction(st: ProjectState | undefined): number {
  if (!st?.s) return 0;
  if (st.s === 'done') return 1;
  return Math.min(Math.max(st.p ?? 0, 0), MAX_WIP_PCT) / 100;
}

/** A player's race distance. */
export function distanceOf(progress: Progress): number {
  let km = 0;
  for (const p of PROJECTS) km += p.km * projectFraction(progress[p.id]);
  return Math.round(km * 10) / 10;
}

/** Points above 100 across every validated project. Breaks ties and fuels the nitro. */
export function bonusOf(progress: Progress): number {
  let bonus = 0;
  for (const st of Object.values(progress)) {
    if (st.s === 'done' && st.g && st.g > 100) bonus += st.g - 100;
  }
  return bonus;
}

export function isUnlocked(p: Project, progress: Progress): boolean {
  return p.requires.every((r) => progress[r]?.s === 'done');
}

export function moduleCompletion(id: ModuleId, progress: Progress): number {
  const list = modulesProjects(id);
  const total = list.reduce((a, p) => a + p.km, 0);
  const got = list.reduce((a, p) => a + p.km * projectFraction(progress[p.id]), 0);
  return got / total;
}

export function isModuleDone(id: ModuleId, progress: Progress): boolean {
  return modulesProjects(id).every((p) => progress[p.id]?.s === 'done');
}

/** Everything that has to be validated before `id`, used for the starting-grid shortcut. */
export function ancestorsOf(id: string): string[] {
  const seen = new Set<string>();
  const walk = (x: string) => {
    for (const r of PROJECT_BY_ID[x]?.requires ?? []) {
      if (!seen.has(r)) {
        seen.add(r);
        walk(r);
      }
    }
  };
  walk(id);
  return [...seen];
}
