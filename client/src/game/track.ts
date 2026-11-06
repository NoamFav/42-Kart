import * as THREE from 'three';
import { SECTORS, TOTAL_KM } from '../../../shared/curriculum.ts';

/**
 * The circuit. Seen from above its centreline draws the digits "42":
 * up the stem of the 4, down its diagonal, along the bar (crossing the stem on a bridge,
 * possible because the road climbs the whole way), then over the 2.
 */

export const ROAD_HALF = 12;
const SPACING = 2;
const GROUND_LEVEL = -34;

type Vertex = [x: number, z: number, radius: number];

function circuitOutline(): Vertex[] {
  const outline: Vertex[] = [
    [380, 700, 0],
    [380, 20, 36],
    [30, 440, 36],
    [500, 440, 46],
    [500, 210, 0],
  ];
  // Top of the 2, clockwise from its left end.
  const [cx, cz, r] = [685, 210, 185];
  for (let deg = 175; deg >= -45; deg -= 5) {
    const a = (deg * Math.PI) / 180;
    outline.push([cx + r * Math.cos(a), cz - r * Math.sin(a), 0]);
  }
  outline.push([517, 640, 34], [960, 640, 0], [1030, 640, 0]);
  return outline;
}

function rounded(vertices: Vertex[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [new THREE.Vector2(vertices[0][0], vertices[0][1])];
  for (let i = 1; i < vertices.length - 1; i++) {
    const [bx, bz, radius] = vertices[i];
    const b = new THREE.Vector2(bx, bz);
    if (!radius) {
      out.push(b);
      continue;
    }
    const a = new THREE.Vector2(vertices[i - 1][0], vertices[i - 1][1]);
    const c = new THREE.Vector2(vertices[i + 1][0], vertices[i + 1][1]);
    const u = a.clone().sub(b).normalize();
    const v = c.clone().sub(b).normalize();
    const angle = Math.acos(THREE.MathUtils.clamp(u.dot(v), -1, 1));
    const reach = radius / Math.tan(angle / 2);
    const start = b.clone().addScaledVector(u, reach);
    const end = b.clone().addScaledVector(v, reach);
    const centre = b.clone().addScaledVector(u.clone().add(v).normalize(), radius / Math.sin(angle / 2));
    const a0 = Math.atan2(start.y - centre.y, start.x - centre.x);
    let delta = Math.atan2(end.y - centre.y, end.x - centre.x) - a0;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    const steps = Math.ceil(Math.abs(delta) * radius / SPACING);
    for (let k = 0; k <= steps; k++) {
      const t = a0 + (delta * k) / steps;
      out.push(new THREE.Vector2(centre.x + radius * Math.cos(t), centre.y + radius * Math.sin(t)));
    }
  }
  const last = vertices[vertices.length - 1];
  out.push(new THREE.Vector2(last[0], last[1]));
  return out;
}

function resample(line: THREE.Vector2[], spacing: number): THREE.Vector2[] {
  const out = [line[0].clone()];
  let carried = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const length = a.distanceTo(b);
    let at = spacing - carried;
    while (at <= length) {
      out.push(a.clone().lerp(b, at / length));
      at += spacing;
    }
    carried = (carried + length) % spacing;
  }
  return out;
}

function smooth(line: THREE.Vector2[], window: number, passes: number): THREE.Vector2[] {
  let current = line;
  for (let pass = 0; pass < passes; pass++) {
    current = current.map((p, i) => {
      if (i < window || i >= current.length - window) return p;
      const sum = new THREE.Vector2();
      for (let k = -window; k <= window; k++) sum.add(current[i + k]);
      return sum.divideScalar(window * 2 + 1);
    });
  }
  return current;
}

export interface Frame {
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
}

export const newFrame = (): Frame => ({
  pos: new THREE.Vector3(),
  tangent: new THREE.Vector3(),
  right: new THREE.Vector3(),
  up: new THREE.Vector3(),
});

class Track {
  readonly length: number;
  readonly count: number;
  readonly groundY = GROUND_LEVEL;
  /** Where km 0 and the finish line sit, leaving room for the grid and a run-off. */
  readonly startS = 90;
  readonly endS: number;

  readonly positions: Float32Array;
  readonly tangents: Float32Array;
  readonly rights: Float32Array;
  readonly ups: Float32Array;
  readonly curvature: Float32Array;
  readonly centre = new THREE.Vector3();

  constructor() {
    const line = smooth(resample(rounded(circuitOutline()), SPACING), 3, 3);
    const flat = resample(line, SPACING);
    const n = flat.length;
    this.count = n;
    this.length = (n - 1) * SPACING;
    this.endS = this.length - 70;

    this.positions = new Float32Array(n * 3);
    this.tangents = new Float32Array(n * 3);
    this.rights = new Float32Array(n * 3);
    this.ups = new Float32Array(n * 3);
    this.curvature = new Float32Array(n);

    const box = new THREE.Box2();
    flat.forEach((p) => box.expandByPoint(p));
    const mid = box.getCenter(new THREE.Vector2());

    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const s = i * SPACING;
      const ramp = THREE.MathUtils.smoothstep(u, 0.84, 1);
      const roll = Math.sin(s / 95) * 3.2 * THREE.MathUtils.smoothstep(u, 0.02, 0.1) * (1 - ramp);
      this.positions[i * 3] = flat[i].x - mid.x;
      this.positions[i * 3 + 1] = 2 + 100 * u + 52 * ramp + roll;
      this.positions[i * 3 + 2] = flat[i].y - mid.y;
    }

    const prev = new THREE.Vector3();
    const next = new THREE.Vector3();
    const t = new THREE.Vector3();
    const tangents: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      prev.fromArray(this.positions, Math.max(i - 1, 0) * 3);
      next.fromArray(this.positions, Math.min(i + 1, n - 1) * 3);
      tangents.push(next.clone().sub(prev).normalize());
    }

    // Signed curvature on the horizontal plane. Positive means the road turns right.
    const raw = new Float32Array(n);
    for (let i = 1; i < n - 1; i++) {
      const a = tangents[i - 1];
      const b = tangents[i + 1];
      raw[i] = -(a.z * b.x - a.x * b.z) / (2 * SPACING);
    }
    const reach = 7;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      let c = 0;
      for (let k = Math.max(0, i - reach); k <= Math.min(n - 1, i + reach); k++) {
        sum += raw[k];
        c++;
      }
      this.curvature[i] = sum / c;
    }

    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      t.copy(tangents[i]);
      right.crossVectors(t, worldUp).normalize();
      up.crossVectors(right, t).normalize();
      // Lean into the corner: the inside edge drops.
      const bank = THREE.MathUtils.clamp(this.curvature[i] * 9, -0.26, 0.26);
      const c = Math.cos(bank);
      const sn = Math.sin(bank);
      const bankedRight = right.clone().multiplyScalar(c).addScaledVector(up, -sn);
      const bankedUp = up.clone().multiplyScalar(c).addScaledVector(right, sn);
      t.toArray(this.tangents, i * 3);
      bankedRight.toArray(this.rights, i * 3);
      bankedUp.toArray(this.ups, i * 3);
    }
  }

  /** Track distance for a race distance. */
  sOf(km: number): number {
    return this.startS + (km / TOTAL_KM) * (this.endS - this.startS);
  }

  kmOf(s: number): number {
    return ((s - this.startS) / (this.endS - this.startS)) * TOTAL_KM;
  }

  frameAt(s: number, out: Frame): Frame {
    const f = THREE.MathUtils.clamp(s / SPACING, 0, this.count - 1.001);
    const i = Math.floor(f);
    const t = f - i;
    const lerp = (src: Float32Array, dst: THREE.Vector3) => {
      const a = i * 3;
      dst.set(
        src[a] + (src[a + 3] - src[a]) * t,
        src[a + 1] + (src[a + 4] - src[a + 1]) * t,
        src[a + 2] + (src[a + 5] - src[a + 2]) * t,
      );
    };
    lerp(this.positions, out.pos);
    lerp(this.tangents, out.tangent);
    lerp(this.rights, out.right);
    lerp(this.ups, out.up);
    out.tangent.normalize();
    out.right.normalize();
    out.up.normalize();
    return out;
  }

  curvatureAt(s: number): number {
    const i = THREE.MathUtils.clamp(Math.round(s / SPACING), 0, this.count - 1);
    return this.curvature[i];
  }

  /** Shortest horizontal distance from a point to the centreline, with the road height there. */
  nearest(x: number, z: number, step = 6): { distance: number; y: number } {
    let best = Infinity;
    let y = 0;
    for (let i = 0; i < this.count; i += step) {
      const dx = this.positions[i * 3] - x;
      const dz = this.positions[i * 3 + 2] - z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        y = this.positions[i * 3 + 1];
      }
    }
    return { distance: Math.sqrt(best), y };
  }

  /** Colour of the sector at a track distance, blending across each boundary. */
  colorAt(s: number, out: THREE.Color): THREE.Color {
    const km = THREE.MathUtils.clamp(this.kmOf(s), 0, TOTAL_KM - 0.01);
    const index = SECTORS.findIndex((sec) => km < sec.end);
    const sector = SECTORS[index];
    out.set(sector.color);
    const next = SECTORS[index + 1];
    const fade = 14;
    if (next && sector.end - km < fade) {
      out.lerp(new THREE.Color(next.color), 0.5 * (1 - (sector.end - km) / fade));
    }
    const prev = SECTORS[index - 1];
    if (prev && km - sector.start < fade) {
      out.lerp(new THREE.Color(prev.color), 0.5 * (1 - (km - sector.start) / fade));
    }
    return out;
  }
}

export const track = new Track();
export type { Track };
