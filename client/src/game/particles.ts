import * as THREE from 'three';

const MAX = 2600;

const VERTEX = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  varying vec4 vColor;
  uniform float uScale;
  uniform float uMaxSize;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(aSize * uScale / max(-mv.z, 0.1), uMaxSize);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.08, d);
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }
`;

export interface Burst {
  gravity?: number;
  drag?: number;
  shrink?: boolean;
}

/** One pooled point cloud for every spark, puff and confetti flake in the scene. */
export class Particles {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private col = new Float32Array(MAX * 4);
  private size = new Float32Array(MAX);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private span = new Float32Array(MAX);
  private base = new Float32Array(MAX);
  private grav = new Float32Array(MAX);
  private drag = new Float32Array(MAX);
  private cursor = 0;
  private material: THREE.ShaderMaterial;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uScale: { value: 600 }, uMaxSize: { value: 40 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
  }

  setScale(viewportHeight: number) {
    this.material.uniforms.uScale.value = viewportHeight * 0.9;
    this.material.uniforms.uMaxSize.value = viewportHeight * 0.022;
  }

  emit(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    color: THREE.Color, size: number, life: number,
    opts: Burst = {},
  ) {
    const i = this.cursor;
    this.cursor = (i + 1) % MAX;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([color.r, color.g, color.b, 1], i * 4);
    this.base[i] = size;
    this.size[i] = size;
    this.life[i] = life;
    this.span[i] = life;
    this.grav[i] = opts.gravity ?? 0;
    this.drag[i] = opts.drag ?? 0;
  }

  burst(origin: THREE.Vector3, count: number, speed: number, colors: THREE.Color[], size: number, life: number, opts: Burst = {}) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 1.1 + 0.15;
      const v = speed * (0.35 + Math.random() * 0.8);
      this.emit(
        origin.x, origin.y, origin.z,
        Math.cos(a) * v, up * v, Math.sin(a) * v,
        colors[k % colors.length], size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.7),
        opts,
      );
    }
  }

  update(dt: number) {
    const g = this.points.geometry;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) {
        if (this.size[i] !== 0) this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const a = i * 3;
      const drag = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[a] *= drag;
      this.vel[a + 1] = this.vel[a + 1] * drag - this.grav[i] * dt;
      this.vel[a + 2] *= drag;
      this.pos[a] += this.vel[a] * dt;
      this.pos[a + 1] += this.vel[a + 1] * dt;
      this.pos[a + 2] += this.vel[a + 2] * dt;
      const t = Math.max(this.life[i] / this.span[i], 0);
      this.col[i * 4 + 3] = Math.min(1, t * 2.2);
      this.size[i] = this.base[i] * (0.4 + 0.6 * t);
    }
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}
