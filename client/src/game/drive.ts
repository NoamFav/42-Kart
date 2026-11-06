import * as THREE from 'three';
import { SECTORS } from '../../../shared/curriculum.ts';
import { ROAD_HALF, track } from './track.ts';

export interface DriveInput {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  drift: boolean;
}

export interface DriveCallbacks {
  onBarrier(): void;
  onWall(speed: number): void;
  onBoost(): void;
  onSector(sector: number, ms: number): void;
}

const MAX_SPEED = 62;
const BOOST_SPEED = 92;
const ACCEL = 34;
const WALL = ROAD_HALF - 1.5;

/**
 * Arcade kart physics, in track space: distance along the centreline, lateral offset and heading.
 * Working in track space keeps bridges simple and makes walls a clamp on one number.
 * The road's curvature feeds back into the heading, so corners still have to be steered through.
 */
export class Driver {
  s = track.sOf(0) - 6;
  lat = 0;
  heading = 0;
  speed = 0;
  steer = 0;
  drifting = false;
  driftCharge = 0;
  boost = 0;
  /** Furthest distance this player has earned. */
  frontierS: number;
  /** Project gates this player has validated: each one is a boost pad. */
  boostGates: number[];

  input: DriveInput = { throttle: false, brake: false, left: false, right: false, drift: false };
  /** Touch and gamepad steering, -1 to 1, used when non-zero. */
  analog = 0;

  sectorStart: { index: number; at: number } | null = null;
  private clock = 0;
  private callbacks: DriveCallbacks;
  private barrierCooldown = 0;

  constructor(frontierS: number, boostGates: number[], callbacks: DriveCallbacks) {
    this.frontierS = frontierS;
    this.boostGates = boostGates;
    this.callbacks = callbacks;
  }

  reset() {
    this.s = track.sOf(0) - 6;
    this.lat = 0;
    this.heading = 0;
    this.speed = 0;
    this.boost = 0;
    this.sectorStart = null;
  }

  update(dt: number) {
    this.clock += dt * 1000;
    this.barrierCooldown = Math.max(0, this.barrierCooldown - dt);
    const { input } = this;
    const previousS = this.s;

    const steerTarget = this.analog || (input.left ? -1 : 0) + (input.right ? 1 : 0);
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 9);

    const top = this.boost > 0 ? BOOST_SPEED : MAX_SPEED;
    if (input.throttle) this.speed += (this.speed < top ? ACCEL : -ACCEL * 0.6) * dt;
    else this.speed -= Math.sign(this.speed) * 11 * dt;
    if (input.brake) this.speed -= (this.speed > 0 ? 70 : 22) * dt;
    if (!input.throttle && !input.brake && Math.abs(this.speed) < 0.4) this.speed = 0;
    this.speed = THREE.MathUtils.clamp(this.speed, -18, BOOST_SPEED);
    this.boost = Math.max(0, this.boost - dt);

    // Holding drift while steering tightens the line and charges a boost.
    const wantsDrift = input.drift && Math.abs(this.speed) > 18 && Math.abs(steerTarget) > 0.1;
    if (wantsDrift) this.driftCharge += dt;
    else if (this.drifting) {
      if (this.driftCharge > 0.7) {
        this.boost = Math.min(1.8, 0.5 + this.driftCharge * 0.6);
        this.callbacks.onBoost();
      }
      this.driftCharge = 0;
    }
    this.drifting = wantsDrift;

    const grip = THREE.MathUtils.clamp(Math.abs(this.speed) / 26, 0, 1);
    const turnRate = this.drifting ? 2.15 : 1.5;
    this.heading += this.steer * turnRate * grip * Math.sign(this.speed || 1) * dt;

    const kappa = track.curvatureAt(this.s);
    const along = this.speed * Math.cos(this.heading);
    const ds = (along / Math.max(0.3, 1 - kappa * this.lat)) * dt;
    this.heading -= kappa * ds;
    this.heading = THREE.MathUtils.clamp(this.heading, -1.4, 1.4);
    this.s += ds;
    this.lat += this.speed * Math.sin(this.heading) * dt * (this.drifting ? 0.92 : 1);

    if (Math.abs(this.lat) > WALL) {
      const side = Math.sign(this.lat);
      this.lat = side * WALL;
      if (this.heading * side > 0) this.heading *= 0.55;
      this.speed *= 1 - Math.min(0.9, dt * 1.6);
      this.callbacks.onWall(Math.abs(this.speed));
    }

    if (this.s > this.frontierS) {
      this.s = this.frontierS;
      this.speed = -Math.abs(this.speed) * 0.42;
      if (!this.barrierCooldown) {
        this.barrierCooldown = 1.4;
        this.callbacks.onBarrier();
      }
    }
    if (this.s < 4) {
      this.s = 4;
      this.speed = Math.max(0, this.speed);
    }

    for (const gate of this.boostGates) {
      if (previousS < gate && this.s >= gate) {
        this.boost = Math.max(this.boost, 1.1);
        this.speed = Math.max(this.speed, MAX_SPEED);
        this.callbacks.onBoost();
      }
    }

    for (const sector of SECTORS) {
      const start = track.sOf(sector.start);
      const end = track.sOf(sector.end);
      if (previousS < start && this.s >= start) this.sectorStart = { index: sector.index, at: this.clock };
      if (previousS < end && this.s >= end) {
        if (this.sectorStart?.index === sector.index) this.callbacks.onSector(sector.index, this.clock - this.sectorStart.at);
        this.sectorStart = null;
      }
    }
  }

  sectorElapsed(): number | null {
    return this.sectorStart ? this.clock - this.sectorStart.at : null;
  }
}
