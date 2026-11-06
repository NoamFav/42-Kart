import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { PROJECTS, PROJECT_BY_ID, SECTORS, TOTAL_KM } from '../../../shared/curriculum.ts';
import type { Effect, ItemId, KartConfig, LivePacket, PlayerPublic, RaceEvent } from '../../../shared/protocol.ts';
import { sfx } from '../audio.ts';
import { Driver } from './drive.ts';
import type { DriveCallbacks } from './drive.ts';
import { buildGates, buildGround, buildRoad, buildScenery, buildSky, buildStartFinish, gateStateFor } from './environment.ts';
import type { Gate, RoadUniforms, Scenery } from './environment.ts';
import { buildKart } from './kartModel.ts';
import type { KartParts } from './kartModel.ts';
import { Particles } from './particles.ts';
import { ROAD_HALF, newFrame, track } from './track.ts';

export type CameraMode = 'tour' | 'drone' | 'follow' | 'drive';

const LANES = [0, 4.6, -4.6, 9, -9];
const KART_GAP = 6.4;
const EFFECT_TAGS: Partial<Record<ItemId, string>> = {
  norminette: 'Norm: KO',
  segfault: 'core dumped',
  leak: 'leaking',
  moulinette: 'moulinetted',
};

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const basis = new THREE.Matrix4();

let radialCache: THREE.CanvasTexture | null = null;
function radialTexture(): THREE.CanvasTexture {
  if (radialCache) return radialCache;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.38)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 128, 128);
  radialCache = new THREE.CanvasTexture(canvas);
  return radialCache;
}

const additive = (color: THREE.ColorRepresentation, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    map: radialTexture(), color, opacity, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
  });

class KartEntity {
  player: PlayerPublic;
  parts: KartParts;
  root = new THREE.Group();
  kartKey: string;

  s: number;
  lat = 0;
  yaw = 0;
  targetS: number;
  targetLat = 0;
  speed = 0;
  tween: { from: number; to: number; t: number; dur: number } | null = null;

  spin = 0;
  hop = 0;
  scale = 1;
  rank = 0;
  effects = new Set<ItemId>();
  live: { s: number; l: number; h: number; v: number; d: number; at: number } | null = null;

  label: HTMLDivElement;
  nameEl: HTMLSpanElement;
  posEl: HTMLSpanElement;
  tagEl: HTMLElement;
  sayEl: HTMLElement;
  sayUntil = 0;

  flames: THREE.Mesh[] = [];
  glow: THREE.Mesh;
  beam: THREE.Mesh;
  marker: THREE.Sprite;
  crown: THREE.Group;
  duck: THREE.Group;

  constructor(player: PlayerPublic, onSelect: (id: string) => void, labels: HTMLElement) {
    this.player = player;
    this.kartKey = JSON.stringify(player.kart);
    this.parts = buildKart(player.kart);
    this.s = this.targetS = track.sOf(player.km);
    this.root.add(this.parts.root);

    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(7, 8), additive(player.kart.paint, 0.5));
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.y = 0.05;
    this.root.add(this.glow);

    this.beam = new THREE.Mesh(new THREE.PlaneGeometry(6, 15), additive('#fff0c8', 0.32));
    this.beam.rotation.x = -Math.PI / 2;
    this.beam.position.set(0, 0.07, 9);
    this.root.add(this.beam);

    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture(), color: new THREE.Color(player.kart.paint).multiplyScalar(2.2),
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false,
    }));
    this.root.add(this.marker);

    this.crown = this.buildCrown();
    this.duck = this.buildDuck();

    for (const pipe of this.parts.exhausts) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.17, 1.1, 7),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a2e').multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      flame.rotation.x = -Math.PI / 2;
      flame.position.copy(pipe).add(new THREE.Vector3(0, 0, -0.6));
      flame.visible = false;
      this.parts.chassis.add(flame);
      this.flames.push(flame);
    }

    this.label = document.createElement('div');
    this.label.className = 'tag';
    this.posEl = document.createElement('span');
    this.posEl.className = 'tag-pos';
    this.nameEl = document.createElement('span');
    this.nameEl.className = 'tag-name';
    this.tagEl = document.createElement('em');
    this.sayEl = document.createElement('q');
    this.label.append(this.sayEl, this.posEl, this.nameEl, this.tagEl);
    this.label.style.setProperty('--paint', player.kart.paint);
    this.label.addEventListener('click', () => onSelect(player.id));
    labels.append(this.label);
  }

  private buildCrown() {
    const g = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({ color: '#ffd24a', emissive: '#a86c00', emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.3, flatShading: true });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 4), gold);
      spike.position.set(Math.cos(a) * 0.24, 0.17, Math.sin(a) * 0.24);
      g.add(spike);
    }
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.26, 0.13, 10), gold));
    g.position.set(0, this.parts.head.position.y + 1.42, this.parts.head.position.z);
    g.visible = false;
    this.parts.chassis.add(g);
    return g;
  }

  private buildDuck() {
    const g = new THREE.Group();
    const yellow = new THREE.MeshStandardMaterial({ color: '#ffd21f', emissive: '#6b4a00', roughness: 0.5, flatShading: true });
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), yellow);
    body.scale.set(1, 0.85, 1.2);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), yellow);
    head.position.set(0, 0.32, 0.2);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 5), new THREE.MeshStandardMaterial({ color: '#ff8a1f' }));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.3, 0.44);
    g.add(body, head, beak);
    g.visible = false;
    this.root.add(g);
    return g;
  }

  rebuild() {
    this.root.remove(this.parts.root);
    this.parts.dispose();
    this.parts = buildKart(this.player.kart);
    this.root.add(this.parts.root);
    this.flames = [];
    this.crown = this.buildCrown();
    for (const pipe of this.parts.exhausts) {
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.17, 1.1, 7),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a2e').multiplyScalar(3), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      );
      flame.rotation.x = -Math.PI / 2;
      flame.position.copy(pipe).add(new THREE.Vector3(0, 0, -0.6));
      flame.visible = false;
      this.parts.chassis.add(flame);
      this.flames.push(flame);
    }
    (this.glow.material as THREE.MeshBasicMaterial).color.set(this.player.kart.paint);
    (this.marker.material as THREE.SpriteMaterial).color.set(this.player.kart.paint).multiplyScalar(2.2);
    this.label.style.setProperty('--paint', this.player.kart.paint);
    this.kartKey = JSON.stringify(this.player.kart);
  }

  destroy() {
    this.parts.dispose();
    this.label.remove();
  }
}

interface Projectile {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  target: KartEntity;
  t: number;
  onHit(): void;
}

interface Shot {
  o: [number, number, number];
  drift: [number, number, number];
}

const SHOTS: Shot[] = [
  { o: [5.2, 1.7, 7.4], drift: [-0.32, 0.03, -0.42] },
  { o: [-8, 2.6, -1.5], drift: [0, 0.02, 0.5] },
  { o: [-2.8, 0.8, 4.8], drift: [0.28, 0.02, 0.1] },
  { o: [0, 3.5, -10], drift: [0.22, 0.03, 0.22] },
  { o: [13, 9, -12], drift: [-0.5, -0.08, 0.34] },
];

export interface WorldOptions {
  canvas: HTMLCanvasElement;
  labels: HTMLElement;
  onSelect?: (id: string) => void;
  onCameraMode?: (mode: CameraMode) => void;
}

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 1, 0.3, 11000);

  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private uniforms: RoadUniforms = { uFrontier: { value: 0 }, uTime: { value: 0 }, uDrone: { value: 1 } };
  private rise = 0;
  private scenery: Scenery;
  private gates: Gate[];
  private particles = new Particles();
  private karts = new Map<string, KartEntity>();
  private projectiles: Projectile[] = [];
  private bolts: { mesh: THREE.Mesh; t: number }[] = [];
  private options: WorldOptions;
  private lastFrame = performance.now();
  private frame = newFrame();
  private raf = 0;
  private disposed = false;

  mode: CameraMode = 'drone';
  focusId: string | null = null;
  meId: string | null = null;
  /** Karts cruise on their own, for the landing page. */
  cruise = false;
  /** Race distances forced by the replay. */
  replayKm: Map<string, number> | null = null;

  driver: Driver | null = null;
  onDriveSample: ((d: Driver) => void) | null = null;
  private barrier: THREE.Mesh;

  private camPos = new THREE.Vector3(0, 900, 700);
  private camLook = new THREE.Vector3();
  private damping = 2;
  private shot = 0;
  private shotAge = 0;
  private heroUntil = 0;
  private time = 0;
  private orbit = { yaw: 0, pitch: 0.26, dist: 10 };

  private frontierKm = 0;
  private displayFrontier = 0;
  private hole: THREE.Group;
  private holeKm = -1;
  private holeS = 0;

  private slowFrames = 0;
  private quality = 2;
  private avg = 16;

  constructor(options: WorldOptions) {
    this.options = options;
    const { canvas } = options;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

    this.scene.background = new THREE.Color(0x030716);
    this.scene.fog = new THREE.FogExp2(0x040a20, 0.0013);

    this.scene.add(new THREE.HemisphereLight(0x8fa6ff, 0x1a2250, 2.3));
    // A fill light on the camera keeps karts readable from every broadcast angle.
    const fill = new THREE.DirectionalLight(0xfff2e0, 1.5);
    fill.position.set(0.4, 0.5, 1);
    this.camera.add(fill, fill.target);
    fill.target.position.set(0, 0, -1);
    this.scene.add(this.camera);
    const sun = new THREE.DirectionalLight(0xbfd0ff, 1.7);
    sun.position.set(300, 700, 240);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0xff66cc, 0.55);
    rim.position.set(-400, 90, -300);
    this.scene.add(rim);

    this.scene.add(buildSky(), buildGround(), buildRoad(this.uniforms), buildStartFinish());
    this.gates = buildGates();
    for (const gate of this.gates) this.scene.add(gate.group);
    this.scenery = buildScenery();
    this.scene.add(this.scenery.group);
    this.scene.add(this.particles.points);

    this.barrier = this.buildBarrier();
    this.scene.add(this.barrier);
    this.hole = this.buildBlackHole();
    this.scene.add(this.hole);

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.62, 0.72, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener('resize', this.resize);
    this.bindPointer();
    this.bindKeyboard();
    this.camLook.set(0, 40, 0);
    this.loop();
  }

  private buildBarrier() {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF * 2, 7),
      new THREE.ShaderMaterial({
        transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: this.uniforms.uTime },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          void main() {
            float stripes = step(0.5, fract((vUv.x * 12.0) + vUv.y * 2.0 - uTime * 0.6));
            float fade = 1.0 - vUv.y;
            vec3 col = mix(vec3(1.0, 0.1, 0.25), vec3(1.0, 0.7, 0.1), stripes);
            gl_FragColor = vec4(col * (0.6 + stripes), fade * 0.8);
          }
        `,
      }),
    );
    mesh.visible = false;
    return mesh;
  }

  private buildBlackHole() {
    const group = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(8, 32, 20), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    group.add(core);
    const disk = new THREE.Mesh(
      new THREE.RingGeometry(9, 26, 96, 1),
      new THREE.ShaderMaterial({
        transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uTime: this.uniforms.uTime },
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec3 vP;
          void main() {
            float r = length(vP.xy);
            float a = atan(vP.y, vP.x);
            float swirl = 0.5 + 0.5 * sin(a * 5.0 + r * 0.7 - uTime * 3.2);
            float falloff = (1.0 - smoothstep(11.0, 26.0, r)) * smoothstep(8.8, 10.5, r);
            vec3 hot = mix(vec3(1.5, 0.45, 0.1), vec3(1.6, 1.2, 0.8), 1.0 - smoothstep(10.0, 20.0, r));
            gl_FragColor = vec4(hot * (0.42 + swirl * 0.9), falloff);
          }
        `,
      }),
    );
    disk.rotation.x = Math.PI / 2 - 0.34;
    group.add(disk);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(74, 74), additive('#ff7b3a', 0.22));
    halo.name = 'halo';
    group.add(halo);
    group.visible = false;
    return group;
  }

  /* ---- Input ---- */

  private bindPointer() {
    const el = this.options.canvas;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener('pointerup', () => (dragging = false));
    window.addEventListener('pointermove', (e) => {
      if (!dragging || this.mode === 'drive' || this.mode === 'drone') return;
      if (this.mode === 'tour' && this.focusId) this.setMode('follow');
      this.orbit.yaw -= (e.clientX - lastX) * 0.006;
      this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + (e.clientY - lastY) * 0.004, 0.02, 1.35);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    el.addEventListener('wheel', (e) => {
      if (this.mode !== 'follow') return;
      this.orbit.dist = THREE.MathUtils.clamp(this.orbit.dist * (1 + e.deltaY * 0.0012), 5, 90);
    }, { passive: true });
  }

  private keyHandler = (e: KeyboardEvent) => {
    const d = this.driver;
    if (!d) return;
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
    const down = e.type === 'keydown';
    const input = d.input;
    let used = true;
    switch (e.code) {
      case 'ArrowUp': case 'KeyW': input.throttle = down; break;
      case 'ArrowDown': case 'KeyS': input.brake = down; break;
      case 'ArrowLeft': case 'KeyA': input.left = down; break;
      case 'ArrowRight': case 'KeyD': input.right = down; break;
      case 'Space': case 'ShiftLeft': input.drift = down; break;
      case 'KeyR': if (down) d.reset(); break;
      default: used = false;
    }
    if (used) e.preventDefault();
  };

  private bindKeyboard() {
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('keyup', this.keyHandler);
  }

  private resize = () => {
    const canvas = this.options.canvas;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setScale(h * this.renderer.getPixelRatio());
  };

  /* ---- Roster ---- */

  setRoster(players: PlayerPublic[], effects: Effect[], meId: string | null) {
    this.meId = meId;
    const seen = new Set<string>();
    for (const player of players) {
      seen.add(player.id);
      let kart = this.karts.get(player.id);
      if (!kart) {
        kart = new KartEntity(player, (id) => this.options.onSelect?.(id), this.options.labels);
        this.karts.set(player.id, kart);
        this.scene.add(kart.root);
      } else {
        kart.player = player;
        if (JSON.stringify(player.kart) !== kart.kartKey) kart.rebuild();
      }
      kart.effects.clear();
    }
    for (const [id, kart] of this.karts) {
      if (!seen.has(id)) {
        this.scene.remove(kart.root);
        kart.destroy();
        this.karts.delete(id);
      }
    }
    for (const e of effects) this.karts.get(e.target)?.effects.add(e.item);
    this.layout();
    this.syncGates();
  }

  private kmFor(k: KartEntity) {
    return this.replayKm?.get(k.player.id) ?? k.player.km;
  }

  /** Spreads karts over lanes so nobody shares a spot, without changing who is ahead of whom. */
  private layout(animate = true) {
    const list = [...this.karts.values()].sort((a, b) => this.kmFor(b) - this.kmFor(a) || a.player.joinedAt - b.player.joinedAt);
    const laneEnd = LANES.map(() => Infinity);
    list.forEach((kart, rank) => {
      kart.rank = rank;
      const desired = track.sOf(this.kmFor(kart));
      let bestLane = 0;
      let bestS = -Infinity;
      LANES.forEach((_, lane) => {
        const s = Math.min(desired, laneEnd[lane] - KART_GAP);
        if (s > bestS + 0.01) {
          bestS = s;
          bestLane = lane;
        }
      });
      laneEnd[bestLane] = bestS;
      kart.targetLat = LANES[bestLane];
      const changed = Math.abs(bestS - kart.targetS) > 0.5;
      kart.targetS = bestS;
      if (changed && animate && !this.replayKm) {
        const distance = Math.abs(kart.targetS - kart.s);
        if (distance > 6) {
          kart.tween = { from: kart.s, to: kart.targetS, t: 0, dur: THREE.MathUtils.clamp(distance / 34, 1.4, 6.5) };
        }
      }
    });
    this.frontierKm = list.length ? Math.max(...list.map((k) => this.kmFor(k))) : 0;
  }

  setFullyLit(lit: boolean) {
    if (lit) this.frontierKm = TOTAL_KM;
  }

  private syncGates() {
    const who = this.karts.get(this.focusId ?? this.meId ?? '');
    for (const gate of this.gates) {
      if (gate.project) gate.setState(gateStateFor(gate.project, who?.player.progress));
    }
  }

  setPace(km: number | null) {
    this.holeKm = km ?? -1;
    this.hole.visible = km !== null;
  }

  /* ---- Camera ---- */

  setMode(mode: CameraMode, focus?: string | null) {
    if (focus !== undefined) this.focusId = focus;
    if (mode === this.mode && focus === undefined) return;
    this.mode = mode;
    this.damping = 1.8;
    this.shotAge = 0;
    if (mode === 'follow') this.orbit = { yaw: 0, pitch: 0.28, dist: 10 };
    this.syncGates();
    this.options.onCameraMode?.(mode);
  }

  focus(id: string | null) {
    this.focusId = id;
    this.syncGates();
    if (id && this.mode === 'drone') this.setMode('follow');
    this.shotAge = 0;
  }

  private heroKart(): KartEntity | null {
    return (this.focusId && this.karts.get(this.focusId)) || [...this.karts.values()].find((k) => k.rank === 0) || null;
  }

  private nextTourFocus() {
    if (this.time < this.heroUntil) return;
    const list = [...this.karts.values()];
    if (!list.length) return;
    const online = list.filter((k) => k.player.online);
    const pool = online.length ? online : list;
    this.focusId = pool[Math.floor(Math.random() * pool.length)].player.id;
    this.syncGates();
  }

  private directCamera(dt: number) {
    const desired = tmp;
    const look = tmp2;
    this.damping = Math.min(this.damping + dt * 1.8, 9);

    if (this.mode === 'drone') {
      const fov = (this.camera.fov * Math.PI) / 180;
      const fit = Math.max(420 / Math.tan(fov / 2), 590 / (Math.tan(fov / 2) * this.camera.aspect));
      const sway = Math.sin(this.time * 0.1) * 24;
      desired.set(sway, fit * 0.97 + 60, fit * 0.3 + 40);
      look.set(0, 40, 22);
      this.ease(desired, look, Math.min(this.damping, 2.4), dt);
      return;
    }

    const kart = this.heroKart();
    if (!kart) {
      desired.set(0, 500, 420);
      look.set(0, 20, 0);
      this.ease(desired, look, 2, dt);
      return;
    }

    const frame = track.frameAt(kart.s, this.frame);
    const kartPos = kart.root.position;

    if (this.mode === 'drive' || this.mode === 'follow') {
      const driving = this.mode === 'drive' && this.driver;
      const yaw = driving ? -this.driver!.heading * 0.72 : this.orbit.yaw;
      const pitch = driving ? 0.22 : this.orbit.pitch;
      const dist = driving ? 8.2 + Math.abs(this.driver!.speed) * 0.035 : this.orbit.dist;
      const back = Math.cos(yaw) * Math.cos(pitch) * dist;
      const side = Math.sin(yaw) * Math.cos(pitch) * dist;
      const high = Math.sin(pitch) * dist + 1.1;
      desired.copy(kartPos).addScaledVector(frame.tangent, -back).addScaledVector(frame.right, side).addScaledVector(frame.up, high);
      look.copy(kartPos).addScaledVector(frame.up, 1.3).addScaledVector(frame.tangent, driving ? 5 : 0);
      this.ease(desired, look, driving ? 11 : Math.min(this.damping, 7), dt);
      const targetFov = driving ? 52 + Math.abs(this.driver!.speed) * 0.26 : 46;
      this.setFov(targetFov, dt);
      return;
    }

    // Tour: a TV director with five angles.
    this.shotAge += dt;
    const heroic = this.time < this.heroUntil;
    if (this.shotAge > (heroic ? 5 : 8.5)) {
      this.shotAge = 0;
      this.shot = (this.shot + 1) % SHOTS.length;
      if (!heroic) this.nextTourFocus();
      this.damping = 1000;
    }
    // A kart on a run outpaces any static angle, so ride along behind it.
    const running = Math.abs(kart.speed) > 12;
    const shot = running ? SHOTS[3] : SHOTS[this.shot];
    const t = running ? 0 : this.shotAge;
    desired.copy(kartPos)
      .addScaledVector(frame.right, shot.o[0] + shot.drift[0] * t)
      .addScaledVector(frame.up, shot.o[1] + shot.drift[1] * t)
      .addScaledVector(frame.tangent, shot.o[2] + shot.drift[2] * t);
    look.copy(kartPos).addScaledVector(frame.up, 0.9);
    if (this.damping >= 1000) {
      this.camPos.copy(desired);
      this.camLook.copy(look);
      this.damping = 9;
    }
    this.ease(desired, look, running ? 16 : Math.min(this.damping, 8), dt);
    this.setFov(running ? 54 : 40, dt);
  }

  private setFov(target: number, dt: number) {
    const next = this.camera.fov + (target - this.camera.fov) * Math.min(1, dt * 4);
    if (Math.abs(next - this.camera.fov) > 0.01) {
      this.camera.fov = next;
      this.camera.updateProjectionMatrix();
    }
  }

  private ease(pos: THREE.Vector3, look: THREE.Vector3, k: number, dt: number) {
    const f = 1 - Math.exp(-k * dt);
    this.camPos.lerp(pos, f);
    this.camLook.lerp(look, f);
    this.camera.position.copy(this.camPos);
    if (this.mode === 'drone') {
      this.camera.up.set(0, 1, 0);
      this.setFov(32, dt);
    } else {
      this.camera.up.set(0, 1, 0);
    }
    this.camera.lookAt(this.camLook);

    // The near plane follows the camera's distance, or the road z-fights from the drone.
    const near = Math.max(0.3, this.camPos.distanceTo(this.camLook) * 0.04);
    if (Math.abs(near - this.camera.near) > this.camera.near * 0.05) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  /* ---- Race events ---- */

  raceEvent(event: RaceEvent) {
    const kart = this.karts.get(event.player);
    if (!kart) return;
    switch (event.type) {
      case 'validate': {
        this.spotlight(kart, 8);
        const project = event.project ? PROJECT_BY_ID[event.project] : null;
        const gate = this.gates.find((g) => g.project?.id === project?.id);
        gate?.pulse();
        const dur = kart.tween?.dur ?? 0.1;
        window.setTimeout(() => this.confetti(kart, (event.grade ?? 100) > 100 ? 320 : 200), dur * 880);
        sfx.boost();
        break;
      }
      case 'fail':
        this.spotlight(kart, 5);
        kart.spin = Math.PI * 4;
        this.smoke(kart, 60);
        sfx.spin();
        break;
      case 'module':
      case 'finish':
        this.spotlight(kart, 8);
        this.confetti(kart, 420);
        sfx.fanfare();
        break;
      case 'item':
      case 'blocked':
        this.throwItem(event);
        break;
      default:
    }
  }

  /** Only the TV director reacts to events. A camera the viewer picked stays where it is. */
  private spotlight(kart: KartEntity, seconds: number) {
    if (this.mode !== 'tour') return;
    // Let a moment land before cutting away, unless the moment is yours.
    if (this.time < this.heroUntil - 2 && kart.player.id !== this.meId) return;
    this.focusId = kart.player.id;
    this.heroUntil = this.time + seconds;
    this.syncGates();
    this.shotAge = 0;
    this.shot = 3;
    this.damping = 1000;
  }

  private confetti(kart: KartEntity, count: number) {
    const colors = [kart.player.kart.paint, kart.player.kart.accent, '#ffe08a', '#27e08b', '#ff4fa3'].map((c) => new THREE.Color(c).multiplyScalar(1.8));
    const origin = kart.root.position.clone().add(new THREE.Vector3(0, 2.4, 0));
    this.particles.burst(origin, count, 19, colors, 0.3, 2.4, { gravity: 16, drag: 1.1 });
  }

  private smoke(kart: KartEntity, count: number) {
    const color = new THREE.Color(0.05, 0.055, 0.075);
    const origin = kart.root.position.clone().add(new THREE.Vector3(0, 1, 0));
    this.particles.burst(origin, count, 6, [color], 1.1, 1.3, { gravity: -2.5, drag: 1.6 });
  }

  private throwItem(event: RaceEvent) {
    const fromId = event.type === 'blocked' ? event.other : event.player;
    const toId = event.type === 'blocked' ? event.player : event.other;
    const from = fromId ? this.karts.get(fromId) : null;
    const target = toId ? this.karts.get(toId) : null;
    if (!target) return;
    const item = event.item;

    const hit = () => {
      if (event.type === 'blocked') {
        target.hop = 1;
        this.particles.burst(target.root.position.clone().setY(target.root.position.y + 1.5), 60, 10, [new THREE.Color('#ffd21f').multiplyScalar(2)], 0.5, 0.9);
        sfx.block();
        return;
      }
      if (item === 'moulinette') {
        const bolt = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 1, 170, 6, 1, true),
          new THREE.MeshBasicMaterial({ color: new THREE.Color('#bfe0ff').multiplyScalar(6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }),
        );
        bolt.position.copy(target.root.position).add(new THREE.Vector3(0, 85, 0));
        this.scene.add(bolt);
        this.bolts.push({ mesh: bolt, t: 0 });
        sfx.zap();
      } else if (item === 'coffee' || item === 'duck') {
        sfx.powerup();
      } else {
        target.spin = Math.PI * 4;
        this.smoke(target, 40);
        sfx.hit();
      }
      this.particles.burst(target.root.position.clone().setY(target.root.position.y + 1.2), 90, 13, [new THREE.Color('#ff9a2e').multiplyScalar(2)], 0.5, 1);
    };

    this.spotlight(target, 6);
    if (!from || from === target) return hit();
    const glowMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4fa3').multiplyScalar(4), toneMapped: false }));
    glowMesh.position.copy(from.root.position);
    this.scene.add(glowMesh);
    this.projectiles.push({ mesh: glowMesh, from: from.root.position.clone(), target, t: 0, onHit: hit });
    sfx.throw();
  }

  honk(id: string) {
    const kart = this.karts.get(id);
    if (!kart) return;
    kart.hop = 1;
    this.particles.burst(kart.root.position.clone().setY(kart.root.position.y + 1.8), 22, 8, [new THREE.Color(kart.player.kart.accent).multiplyScalar(2)], 0.42, 0.6);
  }

  say(id: string, text: string) {
    const kart = this.karts.get(id);
    if (!kart) return;
    kart.sayEl.textContent = text;
    kart.sayUntil = this.time + 7;
    kart.label.classList.add('saying');
  }

  /* ---- Live driving ---- */

  live(packets: LivePacket[]) {
    for (const [id, s, l, h, v, d] of packets) {
      if (id === this.meId) continue;
      const kart = this.karts.get(id);
      if (kart) kart.live = { s, l, h, v, d, at: this.time };
    }
  }

  liveEnd(id: string) {
    const kart = this.karts.get(id);
    if (kart) {
      kart.live = null;
      kart.tween = { from: kart.s, to: kart.targetS, t: 0, dur: 1.4 };
    }
  }

  startDrive(frontierKm: number, callbacks: DriveCallbacks) {
    const me = this.meId ? this.karts.get(this.meId) : null;
    if (!me) return;
    const gates = PROJECTS
      .filter((p) => me.player.progress[p.id]?.s === 'done' && p.kind === 'project')
      .map((p) => track.sOf(p.end));
    this.driver = new Driver(track.sOf(Math.min(frontierKm, TOTAL_KM)), gates, callbacks);
    this.focusId = me.player.id;
    this.barrier.visible = frontierKm < TOTAL_KM - 1;
    const f = track.frameAt(this.driver.frontierS, this.frame);
    this.barrier.position.copy(f.pos).addScaledVector(f.up, 3.5);
    this.barrier.quaternion.setFromRotationMatrix(basis.makeBasis(f.right, f.up, f.tangent.clone().negate()));
    this.setMode('drive');
  }

  stopDrive() {
    this.driver = null;
    this.barrier.visible = false;
    const me = this.meId ? this.karts.get(this.meId) : null;
    if (me) me.tween = { from: me.s, to: me.targetS, t: 0, dur: 1.2 };
    this.setMode('tour');
  }

  /* ---- Frame loop ---- */

  private updateKart(k: KartEntity, dt: number) {
    const isDriving = this.driver !== null && k.player.id === this.meId;
    let heading = 0;
    let drifting = false;
    const before = k.s;

    if (isDriving) {
      const d = this.driver!;
      k.s = d.s;
      k.lat = d.lat;
      heading = d.heading;
      k.speed = d.speed;
      drifting = d.drifting;
    } else if (k.live) {
      const f = 1 - Math.exp(-dt * 12);
      k.s += (k.live.s + k.live.v * (this.time - k.live.at) - k.s) * f;
      k.lat += (k.live.l - k.lat) * f;
      k.yaw += (k.live.h - k.yaw) * f;
      heading = k.yaw;
      k.speed = k.live.v;
      drifting = k.live.d > 0;
      if (this.time - k.live.at > 3) k.live = null;
    } else if (this.cruise) {
      k.speed = 24 + (k.rank % 4) * 3.5;
      k.s += k.speed * dt;
      if (k.s > track.endS) k.s = track.startS;
      k.lat += (k.targetLat - k.lat) * Math.min(1, dt * 2);
    } else if (k.tween) {
      const tw = k.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      k.s = tw.from + (tw.to - tw.from) * e;
      k.speed = dt > 0 ? (k.s - before) / dt : 0;
      if (tw.t >= 1) k.tween = null;
    } else {
      k.s += (k.targetS - k.s) * Math.min(1, dt * (this.replayKm ? 6 : 3));
      k.speed = this.replayKm ? (k.s - before) / Math.max(dt, 0.001) : 0;
    }
    if (!isDriving && !this.cruise && !k.live) k.lat += (k.targetLat - k.lat) * Math.min(1, dt * 2.5);

    const frame = track.frameAt(k.s, this.frame);
    basis.makeBasis(tmp.copy(frame.right).negate(), frame.up, frame.tangent);
    k.root.quaternion.setFromRotationMatrix(basis);
    k.root.position.copy(frame.pos).addScaledVector(frame.right, k.lat).addScaledVector(frame.up, 0.02);

    const moving = Math.abs(k.speed) > 1.5;
    const online = k.player.online || this.cruise;
    const chassis = k.parts.chassis;

    // Spin-outs, hops, lean, and engine shake.
    if (k.spin > 0) {
      const step = Math.min(k.spin, dt * 11);
      k.spin -= step;
    }
    k.hop = Math.max(0, k.hop - dt * 2.6);
    const hover = k.player.kart.body === 'hover' ? 0.16 + Math.sin(this.time * 2.4 + k.rank) * 0.07 : 0;
    const shake = online ? Math.sin(this.time * 34 + k.rank) * (moving ? 0.012 : 0.008) : 0;
    chassis.position.y = hover + shake + Math.sin(k.hop * Math.PI) * 1.1;
    chassis.rotation.y = -heading - k.spin + (drifting ? -Math.sign(this.driver?.steer ?? 0) * 0.4 : 0);
    const steer = isDriving ? this.driver!.steer : 0;
    chassis.rotation.z = steer * 0.05 + (k.effects.has('segfault') ? 0.13 : 0);
    chassis.rotation.x = moving ? -Math.min(Math.abs(k.speed) * 0.0014, 0.07) : 0;

    const spinRate = (k.speed * dt) / 0.36;
    for (const w of k.parts.wheelsFront) {
      w.rotation.y = -steer * 0.42;
      if (w.children[0]) w.children[0].rotation.x += spinRate;
    }
    for (const w of k.parts.wheelsRear) w.rotation.x += spinRate;
    if (k.parts.steering) k.parts.steering.rotation.z = -steer * 1.2;

    const scale = k.effects.has('moulinette') ? 0.58 : 1;
    k.scale += (scale - k.scale) * Math.min(1, dt * 5);
    k.parts.root.scale.setScalar(k.scale);

    const boosting = Math.abs(k.speed) > 26 || k.effects.has('coffee') || (isDriving && this.driver!.boost > 0);
    k.flames.forEach((flame, i) => {
      flame.visible = boosting;
      if (boosting) flame.scale.set(1, 0.8 + Math.random() * 1.1, 1);
      if (boosting && Math.random() < dt * 40) {
        tmp2.copy(k.parts.exhausts[i]).applyQuaternion(k.root.quaternion).add(k.root.position);
        const c = new THREE.Color('#ff8a2e').multiplyScalar(1.6);
        this.particles.emit(tmp2.x, tmp2.y, tmp2.z, -frame.tangent.x * 8, 1, -frame.tangent.z * 8, c, 0.5, 0.42);
      }
    });

    if (drifting && Math.random() < dt * 60) {
      const c = new THREE.Color(this.driver && this.driver.driftCharge > 0.7 ? '#ff4fa3' : '#59f0ff').multiplyScalar(1.7);
      const p = k.root.position;
      this.particles.emit(p.x - frame.tangent.x * 1.4, p.y + 0.2, p.z - frame.tangent.z * 1.4, (Math.random() - 0.5) * 6, 2, (Math.random() - 0.5) * 6, c, 0.4, 0.4);
    }

    if (k.effects.has('segfault') && Math.random() < dt * 12) {
      const p = k.root.position;
      this.particles.emit(p.x, p.y + 1.4, p.z, 0, 2.4, 0, new THREE.Color(0.05, 0.055, 0.075), 0.9, 1.3, { gravity: -1 });
    }
    if (k.effects.has('leak') && Math.random() < dt * 18) {
      const p = k.root.position;
      const c = new THREE.Color('#3fe0ff').multiplyScalar(1.4);
      this.particles.emit(p.x + (Math.random() - 0.5) * 1.2, p.y + 0.6, p.z + (Math.random() - 0.5) * 1.2, 0, -1, 0, c, 0.34, 0.8, { gravity: 9 });
    }
    if (k.spin > 0 && Math.random() < dt * 40) this.smoke(k, 1);

    k.duck.visible = k.effects.has('duck');
    if (k.duck.visible) {
      const a = this.time * 1.6;
      k.duck.position.set(Math.cos(a) * 2.4, 1.3 + Math.sin(a * 2) * 0.2, Math.sin(a) * 2.4);
      k.duck.rotation.y = -a;
    }

    k.crown.visible = k.rank === 0 && k.player.km > 0 && !this.cruise;

    // Headlights only when the driver is around.
    k.beam.visible = online;
    (k.glow.material as THREE.MeshBasicMaterial).opacity = online ? 0.5 : 0.14;

    // Drone-view marker keeps each kart visible from far away.
    const distance = k.root.position.distanceTo(this.camera.position);
    const m = k.marker;
    m.position.set(0, 2.2, 0);
    m.scale.setScalar(distance * 0.03);
    m.material.opacity = THREE.MathUtils.smoothstep(distance, 90, 300) * (online ? 1 : 0.6);
    m.visible = m.material.opacity > 0.01;
  }

  private updateLabels() {
    const w = this.options.canvas.clientWidth;
    const h = this.options.canvas.clientHeight;
    const placed: [number, number][] = [];
    const ordered = [...this.karts.values()].sort((a, b) => a.rank - b.rank);
    for (const k of ordered) {
      tmp.copy(k.root.position).add(tmp2.set(0, 3.3, 0)).project(this.camera);
      const distance = k.root.position.distanceTo(this.camera.position);
      // At road level a tag only makes sense for karts actually in view, not across the map.
      const inRange = this.mode === 'drone' || distance < 240;
      const visible = inRange && tmp.z < 1 && Math.abs(tmp.x) < 1.15 && Math.abs(tmp.y) < 1.15;
      k.label.style.display = visible ? '' : 'none';
      if (!visible) continue;
      const compact = distance > 200;
      const x = (tmp.x * 0.5 + 0.5) * w;
      let y = (-tmp.y * 0.5 + 0.5) * h;
      if (compact) {
        // Karts bunch up on the map: stack their tags instead of piling them.
        while (placed.some(([px, py]) => Math.abs(px - x) < 92 && Math.abs(py - y) < 21)) y -= 21;
        placed.push([x, y]);
      }
      k.label.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${compact ? 0.86 : 1})`;
      k.label.style.zIndex = String(1000 - Math.round(distance));
      k.label.classList.toggle('me', k.player.id === this.meId);
      k.label.classList.toggle('offline', !k.player.online && !this.cruise);
      k.label.classList.toggle('compact', compact);
      k.posEl.textContent = this.cruise ? String(k.player.kart.number) : `P${k.rank + 1}`;
      k.nameEl.textContent = k.player.name;
      const tags = [...k.effects].flatMap((e) => (EFFECT_TAGS[e] ? [EFFECT_TAGS[e]] : []));
      k.tagEl.textContent = tags[0] ?? '';
      if (k.sayUntil && this.time > k.sayUntil) {
        k.sayUntil = 0;
        k.label.classList.remove('saying');
      }
    }
  }

  private updateHole(dt: number) {
    if (this.holeKm < 0) return;
    const target = Math.max(track.sOf(this.holeKm) - 34, 16);
    this.holeS = this.holeS ? this.holeS + (target - this.holeS) * Math.min(1, dt) : target;
    const frame = track.frameAt(this.holeS, this.frame);
    this.hole.position.copy(frame.pos).addScaledVector(frame.up, 16);
    this.hole.children[1].rotation.z += dt * 0.5;
    this.hole.getObjectByName('halo')!.lookAt(this.camera.position);
    if (Math.random() < dt * 30) {
      const a = Math.random() * Math.PI * 2;
      const p = this.hole.position;
      this.particles.emit(p.x + Math.cos(a) * 30, p.y + (Math.random() - 0.5) * 10, p.z + Math.sin(a) * 30, -Math.cos(a) * 16, 0, -Math.sin(a) * 16, new THREE.Color('#ff9a4a').multiplyScalar(1.5), 0.6, 1.5);
    }
  }

  private step(dt: number) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.driver?.update(dt);
    if (this.driver) this.onDriveSample?.(this.driver);
    if (this.replayKm) this.layout(false);

    for (const k of this.karts.values()) this.updateKart(k, dt);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt / 1.05;
      const to = p.target.root.position;
      p.mesh.position.lerpVectors(p.from, to, p.t);
      p.mesh.position.y += Math.sin(p.t * Math.PI) * 15 + 1.2;
      p.mesh.rotation.y += dt * 8;
      const c = new THREE.Color('#ff4fa3').multiplyScalar(1.6);
      this.particles.emit(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, 0, 0, 0, c, 0.8, 0.42);
      if (p.t >= 1) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.onHit();
        this.projectiles.splice(i, 1);
      }
    }

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt * 2.6;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - b.t) * (Math.random() > 0.3 ? 1 : 0.2);
      if (b.t >= 1) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        this.bolts.splice(i, 1);
      }
    }

    // The road lights up behind the leader, like a progress bar made of asphalt.
    const frontier = track.sOf(this.frontierKm) + 2;
    this.displayFrontier += (frontier - this.displayFrontier) * Math.min(1, dt * 1.6);
    this.uniforms.uFrontier.value = this.displayFrontier;

    for (const gate of this.gates) gate.update(dt);
    this.scenery.update(this.time);
    this.updateHole(dt);
    this.particles.update(dt);
    this.directCamera(dt);

    // Rising to the drone view, the city sinks into the ground so the digits can be read.
    const aloft = this.mode === 'drone' ? 1 : 0;
    this.uniforms.uDrone.value += (aloft - this.uniforms.uDrone.value) * Math.min(1, dt * 2.4);
    this.rise += (1 - aloft - this.rise) * Math.min(1, dt * 2);
    const city = this.scenery.group;
    city.visible = this.rise > 0.01;
    city.scale.y = Math.max(this.rise, 0.01);
    city.position.y = track.groundY * (1 - this.rise);

    const fog = this.scene.fog as THREE.FogExp2;
    const wanted = this.mode === 'drone' ? 0.00012 : 0.0013;
    fog.density += (wanted - fog.density) * Math.min(1, dt * 2);

    this.updateLabels();
  }

  private adapt(ms: number) {
    this.avg += (ms - this.avg) * 0.05;
    if (this.avg > 34) this.slowFrames++;
    else this.slowFrames = Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.quality > 0) {
      this.quality--;
      this.slowFrames = 0;
      this.renderer.setPixelRatio(this.quality === 1 ? 1 : 0.75);
      this.bloom.enabled = this.quality > 0;
      this.resize();
    }
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const raw = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (document.hidden) return;
    this.adapt(raw * 1000);
    this.step(Math.min(raw, 0.05));
    this.composer.render();
  };

  sectorAtCamera(): number {
    const kart = this.heroKart();
    if (!kart) return 0;
    const km = track.kmOf(kart.s);
    return Math.max(0, SECTORS.findIndex((s) => km < s.end));
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('keyup', this.keyHandler);
    for (const k of this.karts.values()) k.destroy();
    this.composer.dispose();
    this.renderer.dispose();
  }
}

/** Standalone turntable used by the garage. */
export class Turntable {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private holder = new THREE.Group();
  private parts: KartParts | null = null;
  private raf = 0;
  private canvas: HTMLCanvasElement;
  private angle = 0.7;
  private dragging = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x10152e, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(4, 7, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff5fc4, 1.8);
    rim.position.set(-6, 2, -5);
    this.scene.add(rim);
    this.scene.add(this.holder);

    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(2.7, 2.8, 0.12, 48),
      new THREE.MeshStandardMaterial({ color: 0x0c1230, roughness: 0.5, metalness: 0.5 }),
    );
    plate.position.y = -0.07;
    this.scene.add(plate);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.72, 0.022, 8, 96), new THREE.MeshBasicMaterial({ color: 0x7f8dff }));
    ring.rotation.x = Math.PI / 2;
    this.scene.add(ring);

    this.camera.position.set(0, 3.4, 11.2);
    this.camera.lookAt(0, 0.82, 0);

    canvas.addEventListener('pointerdown', this.down);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointermove', this.move);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.loop();
  }

  private down = () => (this.dragging = true);
  private up = () => (this.dragging = false);
  private move = (e: PointerEvent) => {
    if (this.dragging) this.angle += e.movementX * 0.012;
  };

  private resize = () => {
    const w = this.canvas.clientWidth || 300;
    const h = this.canvas.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  setKart(cfg: KartConfig) {
    if (this.parts) {
      this.holder.remove(this.parts.root);
      this.parts.dispose();
    }
    this.parts = buildKart(cfg);
    this.holder.add(this.parts.root);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.dragging) this.angle += 0.006;
    this.holder.rotation.y = this.angle;
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('pointerup', this.up);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('resize', this.resize);
    this.parts?.dispose();
    this.renderer.dispose();
  }
}
