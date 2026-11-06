import * as THREE from 'three';
import type { BodyId, DriverId, KartConfig } from '../../../shared/protocol.ts';

/** Low-poly karts and drivers, built from primitives. +Z is forward, the road is at y = 0. */

const matCache = new Map<string, THREE.Material>();

function paint(color: string | number, roughness = 0.42, metalness = 0.25): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}`;
  let m = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
    matCache.set(key, m);
  }
  return m;
}

function glow(color: string | number, intensity = 3): THREE.MeshBasicMaterial {
  const key = `glow|${color}|${intensity}`;
  let m = matCache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), toneMapped: false });
    matCache.set(key, m);
  }
  return m;
}

const DARK = 0x14161d;
const STEEL = 0x70788a;
const RUBBER = 0x0c0d11;

function add(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x = 0, y = 0, z = 0,
  rx = 0, ry = 0, rz = 0,
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  parent.add(mesh);
  return mesh;
}

/** A box whose front end narrows and drops, the basic shape of every nose cone here. */
function wedge(w: number, h: number, d: number, frontWidth = 0.5, frontHeight = 0.4): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) > 0) {
      p.setX(i, p.getX(i) * frontWidth);
      if (p.getY(i) > 0) p.setY(i, -h / 2 + h * frontHeight);
    }
  }
  g.computeVertexNormals();
  return g;
}

const cyl = (r: number, h: number, sides = 10, r2 = r) => new THREE.CylinderGeometry(r2, r, h, sides);

function wheel(radius: number, width: number, accent: string) {
  const g = new THREE.Group();
  add(g, cyl(radius, width, 12), paint(RUBBER, 0.9, 0), 0, 0, 0, 0, 0, Math.PI / 2);
  add(g, cyl(radius * 0.55, width + 0.03, 6), paint(accent, 0.3, 0.6), 0, 0, 0, 0, 0, Math.PI / 2);
  return g;
}

interface Built {
  wheelsFront: THREE.Object3D[];
  wheelsRear: THREE.Object3D[];
  exhausts: THREE.Vector3[];
  seat: THREE.Vector3;
  steering?: THREE.Object3D;
}

function placeWheels(root: THREE.Object3D, b: Built, cfg: { r: number; w: number; fx: number; fz: number; rx: number; rz: number; rr?: number; rw?: number }, accent: string) {
  const front = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * cfg.fx, cfg.r, cfg.fz);
    pivot.add(wheel(cfg.r, cfg.w, accent));
    root.add(pivot);
    return pivot;
  });
  const rr = cfg.rr ?? cfg.r;
  const rear = [-1, 1].map((side) => {
    const w = wheel(rr, cfg.rw ?? cfg.w, accent);
    w.position.set(side * cfg.rx, rr, cfg.rz);
    root.add(w);
    return w;
  });
  b.wheelsFront = front;
  b.wheelsRear = rear;
}

function steeringWheel(root: THREE.Object3D, y: number, z: number, accent: string) {
  const col = new THREE.Group();
  col.position.set(0, y, z);
  col.rotation.x = -0.75;
  add(col, new THREE.TorusGeometry(0.17, 0.03, 6, 12), paint(DARK));
  add(col, cyl(0.02, 0.5), paint(STEEL), 0, 0, 0.26, Math.PI / 2);
  add(col, new THREE.BoxGeometry(0.3, 0.035, 0.03), paint(accent));
  root.add(col);
  return col;
}

function bodyClassic(root: THREE.Object3D, p: string, a: string): Built {
  const b: Built = { wheelsFront: [], wheelsRear: [], exhausts: [new THREE.Vector3(0.28, 0.52, -1.5)], seat: new THREE.Vector3(0, 0.4, -0.42) };
  placeWheels(root, b, { r: 0.33, w: 0.28, fx: 0.82, fz: 1.05, rx: 0.86, rz: -0.95, rr: 0.4, rw: 0.42 }, a);
  add(root, new THREE.BoxGeometry(1.15, 0.13, 2.7), paint(DARK), 0, 0.24, -0.05);
  add(root, wedge(1.05, 0.34, 1.05, 0.62, 0.55), paint(p), 0, 0.4, 1.12);
  add(root, wedge(0.28, 0.13, 0.75, 0.8, 0.8), paint(a), 0, 0.57, 0.95);
  for (const side of [-1, 1]) {
    add(root, new THREE.BoxGeometry(0.3, 0.3, 1.25), paint(p), side * 0.68, 0.4, -0.2);
    add(root, new THREE.BoxGeometry(0.31, 0.07, 1.26), paint(a), side * 0.68, 0.48, -0.2);
  }
  add(root, new THREE.BoxGeometry(2.0, 0.09, 0.14), paint(STEEL), 0, 0.32, 1.7);
  add(root, new THREE.BoxGeometry(1.55, 0.2, 0.2), paint(a), 0, 0.36, -1.5);
  add(root, new THREE.BoxGeometry(0.62, 0.42, 0.55), paint(DARK, 0.5, 0.5), 0, 0.5, -1.12);
  add(root, cyl(0.075, 0.5, 8), paint(STEEL, 0.25, 0.9), 0.28, 0.52, -1.35, Math.PI / 2);
  add(root, new THREE.BoxGeometry(0.62, 0.72, 0.13), paint(DARK), 0, 0.72, -0.74, -0.18);
  b.steering = steeringWheel(root, 0.76, 0.28, a);
  return b;
}

function bodyWedge(root: THREE.Object3D, p: string, a: string): Built {
  const b: Built = { wheelsFront: [], wheelsRear: [], exhausts: [new THREE.Vector3(-0.3, 0.42, -1.75), new THREE.Vector3(0.3, 0.42, -1.75)], seat: new THREE.Vector3(0, 0.3, -0.5) };
  placeWheels(root, b, { r: 0.3, w: 0.3, fx: 0.9, fz: 1.05, rx: 0.92, rz: -1.05, rr: 0.36, rw: 0.44 }, a);
  add(root, wedge(1.42, 0.5, 3.4, 0.28, 0.12), paint(p), 0, 0.4, 0.05);
  add(root, wedge(0.4, 0.16, 2.3, 0.4, 0.2), paint(a), 0, 0.62, 0.55);
  add(root, new THREE.BoxGeometry(2.1, 0.05, 0.42), paint(a), 0, 0.28, 1.72);
  add(root, new THREE.BoxGeometry(2.0, 0.07, 0.48), paint(a), 0, 1.15, -1.5);
  for (const side of [-1, 1]) add(root, new THREE.BoxGeometry(0.06, 0.82, 0.5), paint(p), side * 0.92, 0.82, -1.5);
  add(root, cyl(0.09, 0.3, 8), paint(STEEL, 0.25, 0.9), -0.3, 0.42, -1.65, Math.PI / 2);
  add(root, cyl(0.09, 0.3, 8), paint(STEEL, 0.25, 0.9), 0.3, 0.42, -1.65, Math.PI / 2);
  add(root, new THREE.BoxGeometry(0.72, 0.58, 0.13), paint(DARK), 0, 0.76, -0.86, -0.32);
  b.steering = steeringWheel(root, 0.74, 0.16, a);
  return b;
}

function bodyRover(root: THREE.Object3D, p: string, a: string): Built {
  const b: Built = { wheelsFront: [], wheelsRear: [], exhausts: [new THREE.Vector3(0.55, 1.5, -1.25)], seat: new THREE.Vector3(0, 0.82, -0.36) };
  placeWheels(root, b, { r: 0.62, w: 0.48, fx: 1.04, fz: 1.08, rx: 1.04, rz: -1.08 }, a);
  add(root, new THREE.BoxGeometry(1.5, 0.52, 3.05), paint(p), 0, 0.84, 0);
  add(root, wedge(1.42, 0.42, 0.86, 0.86, 0.7), paint(a), 0, 1.22, 1.08);
  add(root, new THREE.BoxGeometry(1.7, 0.32, 0.18), paint(DARK), 0, 0.62, 1.62);
  const bar = paint(STEEL, 0.3, 0.8);
  for (const side of [-1, 1]) {
    add(root, cyl(0.045, 1.25), bar, side * 0.7, 1.68, -0.9);
    add(root, cyl(0.045, 1.3), bar, side * 0.7, 1.72, 0.14, 0.62);
  }
  add(root, cyl(0.045, 1.4), bar, 0, 2.28, -0.9, 0, 0, Math.PI / 2);
  add(root, cyl(0.1, 1.05, 8), paint(STEEL, 0.25, 0.9), 0.55, 1.34, -1.25);
  add(root, new THREE.BoxGeometry(0.74, 0.76, 0.14), paint(DARK), 0, 1.36, -0.76, -0.14);
  for (const side of [-1, 1]) add(root, new THREE.BoxGeometry(0.42, 0.12, 0.05), glow('#fff2c0', 3), side * 0.45, 0.64, 1.72);
  b.steering = steeringWheel(root, 1.26, 0.3, a);
  return b;
}

function bodyHover(root: THREE.Object3D, p: string, a: string): Built {
  const b: Built = { wheelsFront: [], wheelsRear: [], exhausts: [new THREE.Vector3(0, 0.82, -1.82)], seat: new THREE.Vector3(0, 0.58, -0.28) };
  const hull = add(root, cyl(1.2, 0.42, 8, 0.82), paint(p), 0, 0.78, 0);
  hull.scale.set(1, 1, 1.42);
  add(root, wedge(0.72, 0.24, 1.2, 0.3, 0.3), paint(a), 0, 0.92, 1.3);
  add(root, new THREE.BoxGeometry(0.1, 0.68, 0.84), paint(a), 0, 1.3, -1.32, 0.3);
  for (const side of [-1, 1]) add(root, new THREE.BoxGeometry(0.72, 0.07, 0.54), paint(a), side * 1.2, 0.84, -1.04, 0, 0, side * 0.26);
  for (const [x, z] of [[-0.86, 1], [0.86, 1], [-0.92, -1], [0.92, -1]]) {
    add(root, cyl(0.34, 0.12, 8), paint(DARK), x, 0.5, z);
    add(root, cyl(0.26, 0.05, 8), glow(a, 3.4), x, 0.42, z);
  }
  add(root, new THREE.BoxGeometry(0.64, 0.62, 0.13), paint(DARK), 0, 1.22, -0.68, -0.2);
  add(root, cyl(0.2, 0.42, 8, 0.1), paint(DARK, 0.3, 0.8), 0, 0.82, -1.62, Math.PI / 2);
  b.steering = steeringWheel(root, 1.2, 0.34, a);
  return b;
}

function bodyChair(root: THREE.Object3D, p: string, a: string): Built {
  const b: Built = { wheelsFront: [], wheelsRear: [], exhausts: [new THREE.Vector3(0, 0.94, -1.38)], seat: new THREE.Vector3(0, 0.74, -0.08) };
  const metal = paint(STEEL, 0.28, 0.85);
  // Five-star base with casters, as nature intended.
  const casters: THREE.Object3D[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2 + Math.PI / 10;
    const arm = add(root, new THREE.BoxGeometry(0.15, 0.07, 1.02), paint(DARK), Math.sin(angle) * 0.5, 0.33, Math.cos(angle) * 0.5, 0, angle);
    arm.rotation.x = 0.06;
    const caster = new THREE.Group();
    caster.position.set(Math.sin(angle) * 1.02, 0.17, Math.cos(angle) * 1.02);
    add(caster, cyl(0.17, 0.15, 10), paint(RUBBER, 0.8, 0), 0, 0, 0, 0, 0, Math.PI / 2);
    root.add(caster);
    casters.push(caster);
  }
  b.wheelsRear = casters;
  add(root, cyl(0.075, 0.54), metal, 0, 0.58, 0);
  add(root, cyl(0.15, 0.2), paint(DARK), 0, 0.4, 0);
  const seat = add(root, new THREE.BoxGeometry(1.02, 0.18, 1.02), paint(p, 0.75, 0), 0, 0.88, 0);
  seat.scale.z = 1.04;
  add(root, new THREE.BoxGeometry(0.96, 1.28, 0.16), paint(p, 0.75, 0), 0, 1.58, -0.56, -0.13);
  add(root, new THREE.BoxGeometry(0.52, 0.36, 0.13), paint(a, 0.75, 0), 0, 2.32, -0.66, -0.13);
  for (const side of [-1, 1]) {
    add(root, new THREE.BoxGeometry(0.1, 0.1, 0.72), paint(DARK), side * 0.58, 1.2, 0.02);
    add(root, new THREE.BoxGeometry(0.06, 0.34, 0.06), metal, side * 0.58, 1.02, -0.18);
  }
  // The rocket.
  add(root, cyl(0.22, 0.86, 10), paint('#c8ccd6', 0.3, 0.7), 0, 0.94, -0.96, Math.PI / 2);
  add(root, cyl(0.22, 0.32, 10, 0.02), paint(a, 0.3, 0.3), 0, 0.94, -0.42, Math.PI / 2);
  add(root, cyl(0.22, 0.2, 10, 0.3), paint(DARK), 0, 0.94, -1.45, -Math.PI / 2);
  return b;
}

const BODY: Record<BodyId, (root: THREE.Object3D, p: string, a: string) => Built> = {
  classic: bodyClassic, wedge: bodyWedge, rover: bodyRover, hover: bodyHover, chair: bodyChair,
};

const sphere = (r: number, detail = 1) => new THREE.IcosahedronGeometry(r, detail);

function torso(root: THREE.Object3D, color: string) {
  add(root, new THREE.BoxGeometry(0.52, 0.56, 0.36), paint(color, 0.7, 0), 0, 0.36, 0);
  for (const side of [-1, 1]) add(root, new THREE.BoxGeometry(0.13, 0.13, 0.62), paint(color, 0.7, 0), side * 0.34, 0.44, 0.3, 0.42);
}

function driverCadet(root: THREE.Object3D, p: string, a: string) {
  torso(root, a);
  add(root, sphere(0.34, 2), paint(p, 0.22, 0.35), 0, 0.92, 0.02);
  add(root, new THREE.BoxGeometry(0.5, 0.17, 0.26), paint('#0a0d14', 0.08, 0.9), 0, 0.96, 0.21);
  add(root, new THREE.BoxGeometry(0.1, 0.1, 0.6), paint(a, 0.3, 0.2), 0, 1.23, 0);
}

function driverDuck(root: THREE.Object3D) {
  const yellow = paint('#ffd21f', 0.5, 0);
  add(root, sphere(0.42, 2), yellow, 0, 0.36, -0.02).scale.set(1, 0.92, 1.18);
  add(root, sphere(0.31, 2), yellow, 0, 0.98, 0.1);
  add(root, wedge(0.34, 0.11, 0.28, 0.72, 0.8), paint('#ff8a1f', 0.5, 0), 0, 0.94, 0.42);
  for (const side of [-1, 1]) add(root, sphere(0.055, 1), paint('#0a0d14', 0.2, 0), side * 0.15, 1.08, 0.33);
  add(root, wedge(0.28, 0.18, 0.34, 0.2, 0.4), yellow, 0, 0.52, -0.5, 0.6, Math.PI);
}

function driverBot(root: THREE.Object3D, _p: string, a: string) {
  add(root, new THREE.BoxGeometry(0.6, 0.6, 0.42), paint('#b6bdcb', 0.32, 0.8), 0, 0.36, 0);
  add(root, new THREE.BoxGeometry(0.22, 0.14, 0.03), glow(a, 2.6), 0, 0.42, 0.22);
  add(root, new THREE.BoxGeometry(0.6, 0.45, 0.48), paint('#d4d9e3', 0.3, 0.75), 0, 0.94, 0.02);
  for (const side of [-1, 1]) add(root, new THREE.BoxGeometry(0.15, 0.09, 0.03), glow('#59f0ff', 4), side * 0.15, 0.97, 0.27);
  add(root, cyl(0.02, 0.28), paint(STEEL), 0, 1.3, 0);
  add(root, sphere(0.06, 1), glow('#ff4e5c', 4), 0, 1.46, 0);
}

function driverCat(root: THREE.Object3D, p: string, a: string) {
  const fur = paint(p === '#20242e' ? '#7c8496' : p, 0.8, 0);
  torso(root, a);
  add(root, sphere(0.33, 2), fur, 0, 0.92, 0.04).scale.set(1.1, 0.92, 1);
  for (const side of [-1, 1]) {
    add(root, cyl(0.13, 0.26, 4, 0.01), fur, side * 0.22, 1.24, 0.03, 0, 0.78, side * -0.2);
    add(root, sphere(0.05, 1), glow('#b6ff5e', 2.6), side * 0.14, 0.97, 0.33);
    add(root, new THREE.BoxGeometry(0.28, 0.012, 0.012), paint('#f2f4f8'), side * 0.3, 0.84, 0.28, 0, 0, side * 0.16);
  }
  add(root, sphere(0.045, 0), paint('#ff8fb8'), 0, 0.87, 0.36);
}

function driverPenguin(root: THREE.Object3D) {
  const black = paint('#1b1f2a', 0.5, 0.1);
  add(root, sphere(0.42, 2), black, 0, 0.42, 0).scale.set(0.92, 1.18, 0.86);
  add(root, sphere(0.31, 2), paint('#eef1f6', 0.6, 0), 0, 0.38, 0.13).scale.set(0.86, 1.2, 0.8);
  add(root, sphere(0.3, 2), black, 0, 1, 0.03);
  add(root, wedge(0.22, 0.09, 0.26, 0.42, 0.7), paint('#ffa51f', 0.5, 0), 0, 0.97, 0.38);
  for (const side of [-1, 1]) {
    add(root, sphere(0.07, 1), paint('#ffffff', 0.5), side * 0.13, 1.08, 0.26);
    add(root, sphere(0.035, 1), paint('#0a0d14', 0.2), side * 0.13, 1.08, 0.32);
    add(root, new THREE.BoxGeometry(0.1, 0.46, 0.2), black, side * 0.42, 0.46, 0.06, 0, 0, side * 0.22);
  }
}

function driverBug(root: THREE.Object3D) {
  const shell = paint('#2f7a4b', 0.24, 0.5);
  add(root, sphere(0.42, 2), shell, 0, 0.42, -0.06).scale.set(1, 0.9, 1.2);
  add(root, new THREE.BoxGeometry(0.03, 0.42, 0.92), paint('#0e2b1a'), 0, 0.73, -0.06, 0.05);
  add(root, sphere(0.25, 2), paint('#173c28', 0.3, 0.4), 0, 0.86, 0.26);
  for (const side of [-1, 1]) {
    add(root, sphere(0.075, 1), glow('#ff3b4e', 3.6), side * 0.15, 0.93, 0.44);
    add(root, cyl(0.016, 0.52), paint('#0e2b1a'), side * 0.14, 1.28, 0.38, 0.5, 0, side * -0.42);
    add(root, sphere(0.04, 1), glow('#ffd21f', 3), side * 0.25, 1.52, 0.52);
    for (const z of [-0.26, 0.02, 0.28]) add(root, cyl(0.02, 0.52), paint('#0e2b1a'), side * 0.5, 0.42, z, 0, 0, side * 1);
  }
}

const DRIVER: Record<DriverId, (root: THREE.Object3D, p: string, a: string) => void> = {
  cadet: driverCadet, duck: driverDuck, bot: driverBot, cat: driverCat, penguin: driverPenguin, bug: driverBug,
};

/** Round plate with the race number, on the nose. */
function numberPlate(n: number, paintColor: string): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#f7f8fb';
  c.beginPath();
  c.arc(64, 64, 62, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = paintColor;
  c.lineWidth = 8;
  c.stroke();
  c.fillStyle = '#10131b';
  c.font = 'italic 800 74px "Saira Variable", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(String(n), 62, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.CircleGeometry(0.26, 18), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
}

export interface KartParts {
  root: THREE.Group;
  /** Body lean, spin and bounce happen on this node. */
  chassis: THREE.Group;
  wheelsFront: THREE.Object3D[];
  wheelsRear: THREE.Object3D[];
  steering?: THREE.Object3D;
  exhausts: THREE.Vector3[];
  head: THREE.Object3D;
  dispose(): void;
}

export function buildKart(cfg: KartConfig): KartParts {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  const built = BODY[cfg.body](chassis, cfg.paint, cfg.accent);

  const driver = new THREE.Group();
  driver.position.copy(built.seat);
  DRIVER[cfg.driver](driver, cfg.paint, cfg.accent);
  chassis.add(driver);

  const plate = numberPlate(cfg.number, cfg.paint);
  const noses: Record<BodyId, [number, number, number, number]> = {
    classic: [0, 0.57, 1.55, -0.32],
    wedge: [0, 0.44, 1.36, -0.5],
    rover: [0, 1.0, 1.54, 0],
    hover: [0, 0.94, 1.76, -0.3],
    chair: [0, 2.1, -0.72, 0],
  };
  const [nx, ny, nz, tilt] = noses[cfg.body];
  plate.position.set(nx, ny, nz);
  plate.rotation.x = tilt;
  if (cfg.body === 'chair') plate.rotation.y = Math.PI;
  chassis.add(plate);

  return {
    root,
    chassis,
    wheelsFront: built.wheelsFront,
    wheelsRear: built.wheelsRear,
    steering: built.steering,
    exhausts: built.exhausts,
    head: driver,
    dispose() {
      const material = plate.material as THREE.MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
    },
  };
}
