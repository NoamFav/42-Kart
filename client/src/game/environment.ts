import * as THREE from 'three';
import { PROJECTS, SECTORS, TOTAL_KM } from '../../../shared/curriculum.ts';
import type { Project, Progress } from '../../../shared/curriculum.ts';
import { ROAD_HALF, newFrame, track } from './track.ts';

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- Road ---------- */

export interface RoadUniforms {
  uFrontier: { value: number };
  uTime: { value: number };
  /** 0 at road level, 1 from the drone: the road paints itself so the digits stay legible. */
  uDrone: { value: number };
}

const ROAD_VERT = /* glsl */ `
  attribute float aS;
  attribute float aU;
  attribute vec3 aColor;
  varying float vS;
  varying float vU;
  varying vec3 vColor;
  void main() {
    vS = aS; vU = aU; vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ROAD_FRAG = /* glsl */ `
  uniform float uFrontier;
  uniform float uTime;
  uniform float uDrone;
  varying float vS;
  varying float vU;
  varying vec3 vColor;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    float lit = 1.0 - smoothstep(uFrontier - 6.0, uFrontier + 26.0, vS);
    float u = abs(vU);

    vec3 asphalt = mix(vec3(0.016, 0.020, 0.040), vec3(0.042, 0.048, 0.086), lit);
    asphalt += (hash(floor(vec2(vS * 5.0, vU * 60.0))) - 0.5) * 0.004;

    // The edge line keeps a minimum width on screen, however far away the camera is.
    float aa = fwidth(vU);
    float halfLine = max(0.03, aa * 1.2);
    float edge = 1.0 - smoothstep(halfLine, halfLine + aa + 0.012, abs(u - 0.935));
    float kerb = step(0.975, u) * step(0.5, fract(vS / 7.0));
    float dash = (1.0 - smoothstep(0.010, 0.016, u)) * step(fract(vS / 16.0), 0.42);

    // Slow pulses running towards the frontier on the part of the track already reached.
    float pulse = pow(max(0.0, 1.0 - abs(fract((vS - uTime * 46.0) / 340.0) - 0.5) * 12.0), 2.0);

    // Chevrons on the road surface, pointing the way.
    float chev = fract((vS + u * 22.0) / 62.0);
    float chevron = smoothstep(0.0, 0.012, chev) * (1.0 - smoothstep(0.05, 0.062, chev)) * (1.0 - smoothstep(0.42, 0.46, u));

    vec3 col = asphalt;
    col += vColor * edge * mix(0.34, 2.6, lit);
    col += vColor * kerb * mix(0.05, 0.42, lit);
    col += vec3(0.9, 0.95, 1.0) * dash * mix(0.03, 0.24, lit);
    col += vColor * chevron * mix(0.012, 0.11, lit);
    col += vColor * pulse * lit * (0.05 + edge * 2.4);
    col = mix(col, vColor * mix(0.16, 0.74, lit) + vColor * edge * 0.4 * lit, uDrone);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const RAIL_FRAG = /* glsl */ `
  uniform float uFrontier;
  varying float vS;
  varying float vU;
  varying vec3 vColor;
  void main() {
    float lit = 1.0 - smoothstep(uFrontier - 6.0, uFrontier + 26.0, vS);
    float fade = pow(clamp(1.0 - vU, 0.0, 1.0), 1.6);
    float post = smoothstep(0.92, 1.0, abs(fract(vS / 12.0) - 0.5) * 2.0);
    vec3 col = vColor * (fade * mix(0.1, 0.72, lit) + post * mix(0.06, 0.5, lit) * (1.0 - vU));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function buildRoad(uniforms: RoadUniforms): THREE.Group {
  const group = new THREE.Group();
  const n = track.count;
  const frame = newFrame();
  const color = new THREE.Color();

  const top = { pos: new Float32Array(n * 6), s: new Float32Array(n * 2), u: new Float32Array(n * 2), col: new Float32Array(n * 6) };
  const rail = { pos: new Float32Array(n * 12), s: new Float32Array(n * 4), u: new Float32Array(n * 4), col: new Float32Array(n * 12) };
  const under = new Float32Array(n * 12);
  const topIndex: number[] = [];
  const railIndex: number[] = [];
  const underIndex: number[] = [];

  const left = new THREE.Vector3();
  const right = new THREE.Vector3();
  const railHeight = 1.5;
  const skirt = 2.6;

  for (let i = 0; i < n; i++) {
    const s = i * 2;
    track.frameAt(s, frame);
    track.colorAt(s, color);
    left.copy(frame.pos).addScaledVector(frame.right, -ROAD_HALF);
    right.copy(frame.pos).addScaledVector(frame.right, ROAD_HALF);

    left.toArray(top.pos, i * 6);
    right.toArray(top.pos, i * 6 + 3);
    top.s.set([s, s], i * 2);
    top.u.set([-1, 1], i * 2);
    top.col.set([color.r, color.g, color.b, color.r, color.g, color.b], i * 6);

    const up = frame.up;
    const r = i * 12;
    left.toArray(rail.pos, r);
    rail.pos.set([left.x + up.x * railHeight, left.y + up.y * railHeight, left.z + up.z * railHeight], r + 3);
    right.toArray(rail.pos, r + 6);
    rail.pos.set([right.x + up.x * railHeight, right.y + up.y * railHeight, right.z + up.z * railHeight], r + 9);
    rail.s.set([s, s, s, s], i * 4);
    rail.u.set([0, 1, 0, 1], i * 4);
    for (let k = 0; k < 4; k++) rail.col.set([color.r, color.g, color.b], r + k * 3);

    under.set([left.x, left.y - 0.02, left.z, left.x * 1 - 0, left.y - skirt, left.z, right.x, right.y - skirt, right.z, right.x, right.y - 0.02, right.z], i * 12);

    if (i < n - 1) {
      const a = i * 2;
      topIndex.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      const q = i * 4;
      railIndex.push(q, q + 1, q + 4, q + 1, q + 5, q + 4, q + 2, q + 3, q + 6, q + 3, q + 7, q + 6);
      underIndex.push(q, q + 1, q + 4, q + 1, q + 5, q + 4, q + 1, q + 2, q + 5, q + 2, q + 6, q + 5, q + 2, q + 3, q + 6, q + 3, q + 7, q + 6);
    }
  }

  const surface = new THREE.BufferGeometry();
  surface.setAttribute('position', new THREE.BufferAttribute(top.pos, 3));
  surface.setAttribute('aS', new THREE.BufferAttribute(top.s, 1));
  surface.setAttribute('aU', new THREE.BufferAttribute(top.u, 1));
  surface.setAttribute('aColor', new THREE.BufferAttribute(top.col, 3));
  surface.setIndex(topIndex);
  const road = new THREE.Mesh(
    surface,
    new THREE.ShaderMaterial({ vertexShader: ROAD_VERT, fragmentShader: ROAD_FRAG, uniforms: uniforms as never, side: THREE.DoubleSide, toneMapped: false }),
  );
  road.frustumCulled = false;
  group.add(road);

  const railGeometry = new THREE.BufferGeometry();
  railGeometry.setAttribute('position', new THREE.BufferAttribute(rail.pos, 3));
  railGeometry.setAttribute('aS', new THREE.BufferAttribute(rail.s, 1));
  railGeometry.setAttribute('aU', new THREE.BufferAttribute(rail.u, 1));
  railGeometry.setAttribute('aColor', new THREE.BufferAttribute(rail.col, 3));
  railGeometry.setIndex(railIndex);
  const rails = new THREE.Mesh(
    railGeometry,
    new THREE.ShaderMaterial({
      vertexShader: ROAD_VERT, fragmentShader: RAIL_FRAG, uniforms: uniforms as never,
      side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  rails.frustumCulled = false;
  group.add(rails);

  const underGeometry = new THREE.BufferGeometry();
  underGeometry.setAttribute('position', new THREE.BufferAttribute(under, 3));
  underGeometry.setIndex(underIndex);
  underGeometry.computeVertexNormals();
  const underside = new THREE.Mesh(underGeometry, new THREE.MeshLambertMaterial({ color: 0x0a0e1e, side: THREE.DoubleSide }));
  underside.frustumCulled = false;
  group.add(underside);

  group.add(buildPylons());
  return group;
}

function buildPylons(): THREE.Object3D {
  const spots: THREE.Matrix4[] = [];
  const frame = newFrame();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  for (let s = 30; s < track.length; s += 74) {
    track.frameAt(s, frame);
    // A pylon may not come up through a lower stretch of road.
    let blocked = false;
    for (let i = 0; i < s / 2 - 60; i += 4) {
      const dx = track.positions[i * 3] - frame.pos.x;
      const dz = track.positions[i * 3 + 2] - frame.pos.z;
      if (dx * dx + dz * dz < (ROAD_HALF + 5) ** 2) blocked = true;
    }
    if (blocked) continue;
    const height = frame.pos.y - track.groundY - 2;
    position.set(frame.pos.x, track.groundY + height / 2, frame.pos.z);
    scale.set(1, height, 1);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(frame.tangent.x, frame.tangent.z));
    spots.push(m.compose(position, q, scale).clone());
  }
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(5, 1, 2.4),
    new THREE.MeshLambertMaterial({ color: 0x141a30 }),
    spots.length,
  );
  spots.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
  mesh.frustumCulled = false;
  return mesh;
}

/* ---------- Gates ---------- */

export type GateState = 'locked' | 'open' | 'wip' | 'done';

const GATE_COLORS: Record<GateState, string> = {
  locked: '#2b3350',
  open: '#6c7bb0',
  wip: '#c86bff',
  done: '#27e08b',
};

export class Gate {
  readonly project: Project | null;
  readonly s: number;
  readonly group = new THREE.Group();
  private frameMaterial: THREE.MeshBasicMaterial;
  private flash = 0;
  private current = new THREE.Color(GATE_COLORS.locked);
  private target = new THREE.Color(GATE_COLORS.locked);

  constructor(s: number, label: string, sub: string, project: Project | null, big = false) {
    this.s = s;
    this.project = project;
    const frame = track.frameAt(s, newFrame());
    const height = big ? 13 : 10;
    const half = ROAD_HALF + 1;

    this.frameMaterial = new THREE.MeshBasicMaterial({ color: this.current.clone(), toneMapped: false });
    const dark = new THREE.MeshLambertMaterial({ color: 0x0b0f20 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, height, 0.7), dark);
      post.position.set(side * half, height / 2, 0);
      this.group.add(post);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.16, height, 0.16), this.frameMaterial);
      strip.position.set(side * (half - 0.44), height / 2, 0.38);
      this.group.add(strip);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.7, 2.7, 0.6), dark);
    beam.position.set(0, height, 0);
    this.group.add(beam);
    const line = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.7, 0.14, 0.12), this.frameMaterial);
    line.position.set(0, height - 1.42, -0.32);
    this.group.add(line);
    const lineBack = line.clone();
    lineBack.position.z = 0.32;
    this.group.add(lineBack);

    const sign = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - 1, 2.5), new THREE.MeshBasicMaterial({ map: signTexture(label, sub, big), toneMapped: false }));
    sign.position.set(0, height, -0.32);
    sign.rotation.y = Math.PI;
    this.group.add(sign);

    const basis = new THREE.Matrix4().makeBasis(frame.right.clone().negate(), frame.up, frame.tangent);
    this.group.quaternion.setFromRotationMatrix(basis);
    this.group.position.copy(frame.pos);
  }

  setState(state: GateState) {
    this.target.set(GATE_COLORS[state]);
  }

  pulse() {
    this.flash = 1;
  }

  update(dt: number) {
    this.current.lerp(this.target, 1 - Math.exp(-dt * 5));
    this.flash = Math.max(0, this.flash - dt * 0.8);
    const intensity = 1.7 + this.flash * 6;
    this.frameMaterial.color.copy(this.current).multiplyScalar(intensity);
  }
}

function signTexture(label: string, sub: string, big: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 112;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#080c1c';
  c.fillRect(0, 0, canvas.width, canvas.height);
  if (big) {
    for (let x = 0; x < 1024; x += 28) {
      for (let y = 0; y < 2; y++) {
        c.fillStyle = (x / 28 + y) % 2 ? '#f4f6fb' : '#080c1c';
        c.fillRect(x, y * 14, 28, 14);
        c.fillRect(x, 84 + y * 14, 28, 14);
      }
    }
  }
  c.fillStyle = '#f4f6fb';
  c.textBaseline = 'middle';
  c.font = `italic 800 ${big ? 50 : 60}px "Saira Variable", sans-serif`;
  c.textAlign = 'left';
  c.fillText(label.toUpperCase(), 26, 59, 720);
  c.textAlign = 'right';
  c.fillStyle = '#7f8db8';
  c.font = '400 30px Silkscreen, monospace';
  c.fillText(sub, 998, 58);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function buildGates(): Gate[] {
  const gates: Gate[] = [];
  for (const p of PROJECTS) {
    if (p.kind === 'step' && p.id !== 'func_mage') continue;
    const piscine = p.kind === 'step';
    const label = piscine ? 'Python Piscine' : p.name.replace(/^Exam: /, p.kind === 'exam' ? 'Exam ' : '');
    gates.push(new Gate(track.sOf(p.end), label, piscine ? '70 KM' : `${p.km} KM`, p, p.kind === 'exam'));
  }
  return gates;
}

/* ---------- Start and finish ---------- */

export function buildStartFinish(): THREE.Group {
  const group = new THREE.Group();
  const start = new Gate(track.sOf(0) + 8, '42 Kart', 'START', null, true);
  start.setState('done');
  start.update(1);
  group.add(start.group);

  const frame = track.frameAt(track.sOf(TOTAL_KM), newFrame());
  const ringMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe08a').multiplyScalar(3.4), toneMapped: false });
  const finish = new THREE.Group();
  for (const [radius, tube] of [[26, 0.8], [31, 0.28], [36, 0.14]] as const) {
    finish.add(new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 10, 72), ringMaterial));
  }
  finish.position.copy(frame.pos).addScaledVector(frame.up, 13);
  finish.lookAt(finish.position.clone().add(frame.tangent));
  group.add(finish);

  // Checker strip across the road at the finish line.
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const c = canvas.getContext('2d')!;
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
    c.fillStyle = (x + y) % 2 ? '#f4f6fb' : '#0a0d18';
    c.fillRect(x * 16, y * 16, 16, 16);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  for (const s of [track.sOf(TOTAL_KM), track.sOf(0)]) {
    const f = track.frameAt(s, newFrame());
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 1.8, 3.4), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    strip.position.copy(f.pos).addScaledVector(f.up, 0.06);
    strip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, f.tangent, f.up));
    group.add(strip);
  }
  return group;
}

export function gateStateFor(project: Project, progress: Progress | undefined): GateState {
  if (!progress) return 'locked';
  if (project.kind === 'step') {
    const steps = PROJECTS.filter((p) => p.kind === 'step');
    if (steps.every((p) => progress[p.id]?.s === 'done')) return 'done';
    return steps.some((p) => progress[p.id]?.s) ? 'wip' : 'locked';
  }
  const st = progress[project.id];
  if (st?.s === 'done') return 'done';
  if (st?.s === 'wip') return 'wip';
  return project.requires.every((r) => progress[r]?.s === 'done') ? 'open' : 'locked';
}

/* ---------- Sky and ground ---------- */

export function buildSky(): THREE.Object3D {
  const group = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(5200, 32, 18),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 low = vec3(0.012, 0.030, 0.082);
          vec3 mid = vec3(0.006, 0.016, 0.048);
          vec3 top = vec3(0.002, 0.005, 0.016);
          vec3 col = mix(low, mid, smoothstep(-0.05, 0.22, h));
          col = mix(col, top, smoothstep(0.2, 0.8, h));
          float band = exp(-h * h * 49.0) * 0.05;
          col += vec3(0.05, 0.10, 0.36) * band;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  group.add(dome);

  const rng = mulberry(4242);
  const count = 1800;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = rng() * Math.PI * 2;
    const y = rng() * 0.96 + 0.02;
    const r = Math.sqrt(1 - y * y);
    positions.set([Math.cos(theta) * r * 4800, y * 4800, Math.sin(theta) * r * 4800], i * 3);
    const b = 0.3 + rng() * 0.9;
    colors.set([b * 0.8, b * 0.88, b], i * 3);
  }
  const stars = new THREE.BufferGeometry();
  stars.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  stars.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  group.add(new THREE.Points(stars, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false, transparent: true })));
  return group;
}

/** The ground: a dark dot grid, plus the track's own light baked onto it as a soft reflection. */
export function buildGround(): THREE.Object3D {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec2 cell = abs(fract(vWorld.xz / 34.0) - 0.5);
          float dotMask = 1.0 - smoothstep(0.018, 0.03, length(cell - 0.5));
          float falloff = 1.0 - smoothstep(300.0, 1900.0, length(vWorld.xz));
          vec3 col = vec3(0.010, 0.018, 0.044) * (0.25 + falloff * 0.9);
          col += vec3(0.16, 0.26, 0.62) * dotMask * falloff * 0.5;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  base.rotation.x = -Math.PI / 2;
  base.position.y = track.groundY;
  group.add(base);

  const size = 1500;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1536;
  const c = canvas.getContext('2d')!;
  const k = canvas.width / size;
  const px = (v: number) => (v + size / 2) * k;
  c.globalCompositeOperation = 'lighter';
  c.lineCap = 'round';
  const color = new THREE.Color();
  for (const [width, alpha, blur] of [[92, 0.1, 44], [30, 0.2, 12]] as const) {
    c.filter = `blur(${blur}px)`;
    c.lineWidth = width;
    for (let i = 0; i < track.count - 12; i += 12) {
      track.colorAt(i * 2, color);
      c.strokeStyle = `rgba(${color.r * 255 | 0}, ${color.g * 255 | 0}, ${color.b * 255 | 0}, ${alpha})`;
      c.beginPath();
      c.moveTo(px(track.positions[i * 3]), px(track.positions[i * 3 + 2]));
      c.lineTo(px(track.positions[(i + 12) * 3]), px(track.positions[(i + 12) * 3 + 2]));
      c.stroke();
    }
  }
  c.filter = 'none';
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const glowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.55 }),
  );
  glowPlane.rotation.x = -Math.PI / 2;
  glowPlane.position.y = track.groundY + 0.4;
  group.add(glowPlane);
  return group;
}

/* ---------- Scenery: one theme per sector ---------- */

function makeTexture(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

interface Spot {
  x: number;
  z: number;
  roadY: number;
  s: number;
  clearance: number;
}

function spots(sector: number, count: number, near: number, far: number, seed: number): Spot[] {
  const rng = mulberry(seed);
  const out: Spot[] = [];
  const frame = newFrame();
  const sec = SECTORS[sector];
  const s0 = track.sOf(sec.start);
  const s1 = track.sOf(sec.end);
  let tries = 0;
  while (out.length < count && tries++ < count * 10) {
    const s = s0 + rng() * (s1 - s0);
    track.frameAt(s, frame);
    const side = rng() < 0.5 ? -1 : 1;
    const off = near + Math.pow(rng(), 1.5) * (far - near);
    const x = frame.pos.x + frame.right.x * side * off;
    const z = frame.pos.z + frame.right.z * side * off;
    const { distance } = track.nearest(x, z);
    if (distance < near * 0.92) continue;
    out.push({ x, z, roadY: frame.pos.y, s, clearance: distance });
  }
  return out;
}

const dummy = new THREE.Object3D();

function instances(geometry: THREE.BufferGeometry, material: THREE.Material, list: { p: THREE.Vector3; s: THREE.Vector3; r?: number; c?: THREE.Color }[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, list.length);
  list.forEach((item, i) => {
    dummy.position.copy(item.p);
    dummy.scale.copy(item.s);
    dummy.rotation.set(0, item.r ?? 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (item.c) mesh.setColorAt(i, item.c);
  });
  mesh.frustumCulled = false;
  return mesh;
}

export interface Scenery {
  group: THREE.Group;
  update(time: number): void;
}

export function buildScenery(): Scenery {
  const group = new THREE.Group();
  const updates: ((time: number) => void)[] = [];
  const g = track.groundY;
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  /* Malloc Mile: memory blocks, addresses glowing down their sides. */
  {
    const rng = mulberry(11);
    const tex = makeTexture(64, 128, (c) => {
      c.fillStyle = '#060a16';
      c.fillRect(0, 0, 64, 128);
      for (let y = 0; y < 128; y += 8) for (let x = 2; x < 62; x += 8) {
        const on = rng();
        if (on < 0.46) continue;
        c.fillStyle = on > 0.93 ? '#d6fff6' : on > 0.7 ? '#2ee6c5' : '#0e6f62';
        c.fillRect(x, y + 2, 5, 3);
      }
    });
    const material = new THREE.MeshLambertMaterial({ color: 0x0b1224, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.4 });
    group.add(instances(new THREE.BoxGeometry(1, 1, 1), material, spots(0, 120, 34, 240, 101).map((p) => {
      const h = 30 + rng() * 66;
      const w = 12 + rng() * 22;
      return { p: V(p.x, g + h / 2, p.z), s: V(w, h, w), r: Math.floor(rng() * 4) * (Math.PI / 2) + 0.4 };
    })));
  }

  /* Serpent Gardens: tall pines and maze hedges. */
  {
    const rng = mulberry(22);
    const pine = new THREE.ConeGeometry(0.5, 1, 6);
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, emissive: 0x0a2a12, emissiveIntensity: 0.9 });
    const list = spots(1, 230, 30, 250, 202).flatMap((p) => {
      const h = 46 + rng() * 60;
      const w = 15 + rng() * 15;
      const tint = new THREE.Color().setHSL(0.27 + rng() * 0.1, 0.62, 0.17 + rng() * 0.14);
      return [
        { p: V(p.x, g + h * 0.42, p.z), s: V(w, h * 0.84, w), c: tint, r: rng() * 3 },
        { p: V(p.x, g + h * 0.74, p.z), s: V(w * 0.72, h * 0.56, w * 0.72), c: tint.clone().multiplyScalar(1.3), r: rng() * 3 },
      ];
    });
    group.add(instances(pine, material, list));
    const hedge = spots(1, 70, 30, 150, 203).map((p) => {
      const along = rng() < 0.5;
      return { p: V(p.x, g + 9, p.z), s: along ? V(60, 18, 7) : V(7, 18, 60), c: new THREE.Color(0x1c6a33) };
    });
    group.add(instances(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x0d3a18 }), hedge));
  }

  /* Root Canyon: server racks and stacked containers. */
  {
    const rng = mulberry(33);
    const tex = makeTexture(64, 256, (c) => {
      c.fillStyle = '#07090f';
      c.fillRect(0, 0, 64, 256);
      for (let y = 4; y < 256; y += 10) {
        c.fillStyle = '#151a26';
        c.fillRect(3, y, 58, 7);
        for (let x = 6; x < 58; x += 5) {
          const r = rng();
          if (r < 0.7) continue;
          c.fillStyle = r > 0.93 ? '#ff4e4e' : r > 0.82 ? '#7dff9a' : '#ffb02e';
          c.fillRect(x, y + 2, 2, 2);
        }
      }
    });
    const rack = new THREE.MeshLambertMaterial({ color: 0x10131c, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.6 });
    group.add(instances(new THREE.BoxGeometry(1, 1, 1), rack, spots(2, 120, 32, 220, 301).map((p) => {
      const h = 66 + rng() * 80;
      return { p: V(p.x, g + h / 2, p.z), s: V(16 + rng() * 6, h, 16 + rng() * 6), r: rng() * 0.3 };
    })));
    const palette = [0xc25a1f, 0x1f6fa8, 0xb08a1f, 0x7a2f5a, 0x2c7d6b];
    const boxes: { p: THREE.Vector3; s: THREE.Vector3; r: number; c: THREE.Color }[] = [];
    for (const p of spots(2, 60, 36, 190, 302)) {
      const levels = 2 + Math.floor(rng() * 7);
      const r = Math.floor(rng() * 2) * (Math.PI / 2);
      for (let k = 0; k < levels; k++) {
        boxes.push({
          p: V(p.x + (rng() - 0.5) * 3, g + 5 + k * 10.2, p.z + (rng() - 0.5) * 3),
          s: V(24, 10, 10), r: r + (rng() - 0.5) * 0.1,
          c: new THREE.Color(palette[Math.floor(rng() * palette.length)]).multiplyScalar(0.52),
        });
      }
    }
    group.add(instances(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), boxes));
  }

  /* Big-O Bend: bars, sorted, as push_swap intended. */
  {
    const rng = mulberry(44);
    const list: { p: THREE.Vector3; s: THREE.Vector3; r: number; c: THREE.Color }[] = [];
    for (const p of spots(3, 24, 40, 180, 401)) {
      const bars = 12 + Math.floor(rng() * 8);
      const yaw = rng() * Math.PI;
      const dir = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      for (let k = 0; k < bars; k++) {
        const t = k / (bars - 1);
        const h = 34 + t * t * 100;
        const at = dir.clone().multiplyScalar((k - bars / 2) * 7.5).add(V(p.x, 0, p.z));
        if (track.nearest(at.x, at.z).distance < ROAD_HALF + 8) continue;
        list.push({
          p: V(at.x, g + h / 2, at.z),
          s: V(6, h, 6), r: yaw,
          c: new THREE.Color('#ff4fa3').lerp(new THREE.Color('#7a5cff'), t).multiplyScalar(0.34 + t * 0.5),
        });
      }
    }
    group.add(instances(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x220a1c }), list));
  }

  /* Agent Alley: a floating network, thinking. */
  {
    const rng = mulberry(55);
    const nodes = spots(4, 90, 30, 200, 501).map((p) => ({
      p: V(p.x, p.roadY + (rng() - 0.3) * 64, p.z),
      s: V(1, 1, 1).multiplyScalar(2.2 + rng() * 6),
      r: rng() * 6,
      c: new THREE.Color('#a47bff').lerp(new THREE.Color('#ff8ad8'), rng()).multiplyScalar(1.5 + rng() * 1.5),
    }));
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const mesh = instances(new THREE.IcosahedronGeometry(1, 0), material, nodes);
    group.add(mesh);
    const lines: number[] = [];
    nodes.forEach((a, i) => {
      for (let j = i + 1; j < nodes.length; j++) {
        if (a.p.distanceTo(nodes[j].p) < 74) lines.push(...a.p.toArray(), ...nodes[j].p.toArray());
      }
    });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lines), 3));
    const web = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x6a4cc7, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    web.frustumCulled = false;
    group.add(web);
    const original = nodes.map((n) => n.p.y);
    updates.push((time) => {
      nodes.forEach((n, i) => {
        dummy.position.set(n.p.x, original[i] + Math.sin(time * 0.6 + i) * 1.6, n.p.z);
        dummy.scale.copy(n.s);
        dummy.rotation.set(time * 0.3 + i, time * 0.2 + n.r, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /* Packet Pass: antenna masts, with packets arcing between them. */
  {
    const rng = mulberry(66);
    const masts = spots(5, 56, 34, 220, 601).map((p) => {
      const top = p.roadY + 14 + rng() * 42;
      return { base: V(p.x, g, p.z), top };
    });
    group.add(instances(new THREE.CylinderGeometry(0.28, 1, 1, 5), new THREE.MeshLambertMaterial({ color: 0x1b2a4a, emissive: 0x08152c }), masts.map((m) => ({
      p: V(m.base.x, (m.top + g) / 2, m.base.z),
      s: V(3.4, m.top - g, 3.4),
    }))));
    const beacons = instances(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#3fa9ff').multiplyScalar(3.4), toneMapped: false }), masts.map((m) => ({
      p: V(m.base.x, m.top, m.base.z),
      s: V(1.5, 1.5, 1.5),
    })));
    group.add(beacons);

    const routes = Array.from({ length: 70 }, () => {
      const a = masts[Math.floor(rng() * masts.length)];
      const b = masts[Math.floor(rng() * masts.length)];
      return { a: V(a.base.x, a.top, a.base.z), b: V(b.base.x, b.top, b.base.z), speed: 0.1 + rng() * 0.24, phase: rng() };
    });
    const packets = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#9fd4ff').multiplyScalar(2.4), toneMapped: false }), routes.length);
    packets.frustumCulled = false;
    group.add(packets);
    updates.push((time) => {
      routes.forEach((r, i) => {
        const t = (time * r.speed + r.phase) % 1;
        dummy.position.lerpVectors(r.a, r.b, t);
        dummy.position.y += Math.sin(t * Math.PI) * 26;
        dummy.rotation.set(time, time * 0.7, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        packets.setMatrixAt(i, dummy.matrix);
      });
      packets.instanceMatrix.needsUpdate = true;
    });
  }

  /* Transcendence: browser windows adrift in the upper air. */
  {
    const rng = mulberry(77);
    const tex = makeTexture(256, 176, (c) => {
      c.fillStyle = '#0d1430';
      c.fillRect(0, 0, 256, 176);
      c.fillStyle = '#ffe08a';
      c.fillRect(0, 0, 256, 18);
      for (const [i, color] of ['#ff5f57', '#febc2e', '#28c840'].entries()) {
        c.fillStyle = color;
        c.beginPath();
        c.arc(12 + i * 14, 9, 4, 0, 7);
        c.fill();
      }
      c.fillStyle = '#ffe08a';
      c.fillRect(16, 34, 110, 12);
      c.fillStyle = '#39456f';
      for (let y = 58; y < 160; y += 14) c.fillRect(16, y, 90 + ((y * 37) % 110), 6);
    });
    const windows = spots(6, 64, 34, 210, 701).map((p) => ({
      p: V(p.x, p.roadY + (rng() - 0.25) * 74, p.z),
      s: V(30 + rng() * 26, 21 + rng() * 16, 1),
      r: rng() * Math.PI * 2,
    }));
    group.add(instances(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, color: 0xdddddd, toneMapped: false }), windows));
  }

  return { group, update: (time) => updates.forEach((fn) => fn(time)) };
}
