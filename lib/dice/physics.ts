import * as CANNON from "cannon-es";
import { type SolidId, type V3, getSolid, quatRotate, slotCount, slotDirection } from "./geometry";

export interface Bounds {
  /** Half width (x) and half depth (z) of the visible tray floor. */
  hx: number;
  hz: number;
}

export interface SimRequest {
  solids: SolidId[];
  bounds: Bounds;
  seed: number;
}

export interface SimResult {
  fps: number;
  frameCount: number;
  /** Per die: frameCount × 7 floats (px, py, pz, qx, qy, qz, qw). */
  frames: Float32Array[];
  /** Per die: the label slot that ended on top. */
  landed: number[];
  /** Collisions worth a sound: time (s), impact speed and what was hit (0 floor, 1 wall, 2 die). */
  hits: Hit[];
  attempts: number;
}

export interface Hit {
  t: number;
  v: number;
  k: 0 | 1 | 2;
}

export const SIM_FPS = 60;
const STEP = 1 / 120;
const MAX_TIME = 7;
const GRAVITY = 9.82 * 9;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomQuaternion(rnd: () => number): CANNON.Quaternion {
  const u1 = rnd();
  const u2 = rnd() * Math.PI * 2;
  const u3 = rnd() * Math.PI * 2;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return new CANNON.Quaternion(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
}

const shapeCache = new Map<SolidId, CANNON.ConvexPolyhedron>();

function shapeFor(id: SolidId): CANNON.ConvexPolyhedron {
  let s = shapeCache.get(id);
  if (!s) {
    const solid = getSolid(id);
    s = new CANNON.ConvexPolyhedron({
      vertices: solid.vertices.map((p) => new CANNON.Vec3(p[0], p[1], p[2])),
      faces: solid.faces.map((f) => f.verts.slice()),
    });
    shapeCache.set(id, s);
  }
  return s;
}

interface Attempt {
  frames: number[][];
  landed: number[];
  flatness: number;
  inside: boolean;
  hits: Hit[];
}

function simulateOnce(req: SimRequest, rnd: () => number): Attempt {
  const { hx, hz } = req.bounds;
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0), allowSleep: true });
  (world.solver as CANNON.GSSolver).iterations = 12;

  const floorMat = new CANNON.Material("floor");
  const wallMat = new CANNON.Material("wall");
  const diceMat = new CANNON.Material("dice");
  world.addContactMaterial(new CANNON.ContactMaterial(floorMat, diceMat, { friction: 0.28, restitution: 0.42 }));
  world.addContactMaterial(new CANNON.ContactMaterial(wallMat, diceMat, { friction: 0.05, restitution: 0.75 }));
  world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.08, restitution: 0.5 }));

  const plane = (mat: CANNON.Material, pos: V3, euler: V3) => {
    const b = new CANNON.Body({ mass: 0, material: mat, shape: new CANNON.Plane() });
    b.position.set(pos[0], pos[1], pos[2]);
    b.quaternion.setFromEuler(euler[0], euler[1], euler[2]);
    world.addBody(b);
    return b;
  };
  const floor = plane(floorMat, [0, 0, 0], [-Math.PI / 2, 0, 0]);
  plane(wallMat, [-hx, 0, 0], [0, Math.PI / 2, 0]);
  plane(wallMat, [hx, 0, 0], [0, -Math.PI / 2, 0]);
  plane(wallMat, [0, 0, -hz], [0, 0, 0]);
  plane(wallMat, [0, 0, hz], [0, Math.PI, 0]);
  plane(wallMat, [0, 22, 0], [Math.PI / 2, 0, 0]);

  // Throw from one of the four edges, towards the middle of the tray.
  const side = Math.floor(rnd() * 4);
  const n = req.solids.length;
  const spacing = 2.9;
  const alongLen = side % 2 === 0 ? hx * 2 : hz * 2;
  const perRow = Math.max(1, Math.floor((alongLen - 2.4) / spacing));
  const inward: V3 = side === 0 ? [0, 0, -1] : side === 1 ? [-1, 0, 0] : side === 2 ? [0, 0, 1] : [1, 0, 0];
  const along: V3 = side % 2 === 0 ? [1, 0, 0] : [0, 0, 1];
  const edgeDist = (side % 2 === 0 ? hz : hx) - 1.7;
  const aim = (rnd() - 0.5) * 0.5;

  const hits: Hit[] = [];
  let time = 0;
  const lastHit = new Map<number, number>();

  const bodies = req.solids.map((id, i) => {
    const solid = getSolid(id);
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, n - row * perRow);
    const col = i % perRow;
    const offset = (col - (inRow - 1) / 2) * spacing + (rnd() - 0.5) * 0.6;
    const start: V3 = [
      -inward[0] * edgeDist + along[0] * offset,
      2.6 + row * 2.9 + rnd() * 1.2,
      -inward[2] * edgeDist + along[2] * offset,
    ];
    const body = new CANNON.Body({
      mass: solid.mass,
      shape: shapeFor(id),
      material: diceMat,
      linearDamping: 0.08,
      angularDamping: 0.12,
      allowSleep: true,
      sleepSpeedLimit: 0.35,
      sleepTimeLimit: 0.25,
    });
    body.position.set(start[0], start[1], start[2]);
    body.quaternion.copy(randomQuaternion(rnd));
    const speed = 20 + rnd() * 12;
    const spread = aim + (rnd() - 0.5) * 0.35;
    const dir: V3 = [inward[0] + along[0] * spread, 0, inward[2] + along[2] * spread];
    const dl = Math.hypot(dir[0], dir[2]);
    body.velocity.set((dir[0] / dl) * speed, 2 + rnd() * 5, (dir[2] / dl) * speed);
    const spin = 14 + rnd() * 20;
    const ax = new CANNON.Vec3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5);
    ax.normalize();
    body.angularVelocity.set(ax.x * spin, ax.y * spin, ax.z * spin);
    body.addEventListener("collide", (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
      const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
      if (v < 2.2) return;
      // a die-die contact is reported by both dice: count it once
      if (e.body !== floor && e.body.mass > 0 && e.body.id < body.id) return;
      const prev = lastHit.get(body.id) ?? -1;
      if (time - prev < 0.06) return;
      lastHit.set(body.id, time);
      hits.push({ t: time, v, k: e.body === floor ? 0 : e.body.mass > 0 ? 2 : 1 });
    });
    world.addBody(body);
    return body;
  });

  const frames: number[][] = bodies.map(() => []);
  const record = () => {
    bodies.forEach((b, i) => {
      const f = frames[i];
      f.push(b.position.x, b.position.y, b.position.z, b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    });
  };
  record();
  let step = 0;
  let quietFor = 0;
  while (time < MAX_TIME) {
    world.step(STEP);
    time += STEP;
    step++;
    if (step % 2 === 0) record();
    const allAsleep = bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING);
    const allSlow = bodies.every((b) => b.velocity.lengthSquared() < 0.25 && b.angularVelocity.lengthSquared() < 0.25);
    quietFor = allSlow ? quietFor + STEP : 0;
    if (allAsleep || (time > 1.2 && quietFor > 0.35)) break;
  }
  if (step % 2 !== 0) record();

  let flatness = 1;
  let inside = true;
  const landed = bodies.map((b, i) => {
    const solid = getSolid(req.solids[i]);
    const q: [number, number, number, number] = [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w];
    let best = -1;
    let bestY = -Infinity;
    for (let s = 0; s < slotCount(solid); s++) {
      const y = quatRotate(q, slotDirection(solid, s))[1];
      if (y > bestY) {
        bestY = y;
        best = s;
      }
    }
    flatness = Math.min(flatness, bestY);
    if (Math.abs(b.position.x) > hx + 0.3 || Math.abs(b.position.z) > hz + 0.3 || b.position.y < -0.3) inside = false;
    return best;
  });

  return { frames, landed, flatness, inside, hits };
}

/**
 * Throws the dice in a physics world and records every frame. The throw is
 * repeated (with new random conditions) when a die ends up cocked on another
 * die or on its rim, so the result is always readable.
 */
export function simulateThrow(req: SimRequest): SimResult {
  const rnd = mulberry32(req.seed || 1);
  let best: Attempt | null = null;
  let attempts = 0;
  for (let a = 0; a < 5; a++) {
    attempts++;
    const at = simulateOnce(req, rnd);
    const good = at.inside && at.flatness > 0.97;
    if (!best || (at.inside && !best.inside) || (at.inside === best.inside && at.flatness > best.flatness)) best = at;
    if (good) break;
  }
  const b = best!;
  const frameCount = b.frames[0]?.length ? b.frames[0].length / 7 : 0;
  return {
    fps: SIM_FPS,
    frameCount,
    frames: b.frames.map((f) => Float32Array.from(f)),
    landed: b.landed,
    hits: b.hits,
    attempts,
  };
}
