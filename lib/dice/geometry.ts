/**
 * Pure geometry for every physical die (no three.js / cannon here, so it runs
 * in the browser, in a worker and in Node tests).
 *
 * Each solid is described by its vertices; faces are found by enumerating the
 * supporting planes of the vertex set, so the same code builds a cube, a
 * pentagonal trapezohedron (d10) or the 24 kite faces of the rune die.
 */

export type V3 = [number, number, number];

export const vec = {
  add: (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: V3, b: V3): V3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a: V3): number => Math.hypot(a[0], a[1], a[2]),
  norm: (a: V3): V3 => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a: V3, b: V3, t: number): V3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
  avg: (pts: V3[]): V3 => {
    const s: V3 = [0, 0, 0];
    for (const p of pts) {
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
    }
    return [s[0] / pts.length, s[1] / pts.length, s[2] / pts.length];
  },
  /** Component of `a` lying in the plane with unit normal `n`. */
  reject: (a: V3, n: V3): V3 => {
    const d = a[0] * n[0] + a[1] * n[1] + a[2] * n[2];
    return [a[0] - n[0] * d, a[1] - n[1] * d, a[2] - n[2] * d];
  },
};

export type SolidId = "coin" | "d4" | "d6" | "d8" | "d10" | "d12" | "d20" | "d24";

export const SOLID_IDS: SolidId[] = ["coin", "d4", "d6", "d8", "d10", "d12", "d20", "d24"];

export interface Face {
  /** Vertex indices, counter-clockwise seen from outside. */
  verts: number[];
  /** Outward unit normal. */
  normal: V3;
  /** Where the label is centred (largest inscribed circle centre). */
  center: V3;
  /** Unit vector in the face plane: the "top" of the label. */
  up: V3;
  /** Radius of the largest circle around `center` inside the face. */
  inradius: number;
  /** Largest distance from `center` to a face vertex. */
  extent: number;
  /** Index of the face on the opposite side (parallel, facing away), or -1. */
  opposite: number;
}

export interface Solid {
  id: SolidId;
  vertices: V3[];
  faces: Face[];
  /** Faces that carry a label (the coin rim has none). */
  labelFaces: number[];
  /** The d4 is read by the vertex that points up, every other die by its top face. */
  readMode: "face" | "vertex";
  /** For vertex-read dice: per-vertex frame (direction and a reference neighbour direction). */
  vertexFrames: { dir: V3; ref: V3 }[];
  /** Circumradius after scaling. */
  radius: number;
  /** Rough volume-ish size used to scale mass. */
  mass: number;
}

const PHI = (1 + Math.sqrt(5)) / 2;

/** Target circumradius of each die, in tray units. */
const TARGET_RADIUS: Record<SolidId, number> = {
  coin: 1.05,
  d4: 1.5,
  d6: 1.22,
  d8: 1.32,
  d10: 1.3,
  d12: 1.3,
  d20: 1.32,
  d24: 1.32,
};

const MASS: Record<SolidId, number> = {
  coin: 0.55,
  d4: 0.8,
  d6: 1,
  d8: 1,
  d10: 1,
  d12: 1.1,
  d20: 1.1,
  d24: 1.15,
};

function rawSolid(id: SolidId): { verts: V3[]; apex?: Set<number> } {
  switch (id) {
    case "coin": {
      const n = 24;
      const h = 0.15;
      const verts: V3[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        verts.push([Math.cos(a), h, Math.sin(a)]);
      }
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        verts.push([Math.cos(a), -h, Math.sin(a)]);
      }
      return { verts };
    }
    case "d4":
      return {
        verts: [
          [1, 1, 1],
          [1, -1, -1],
          [-1, 1, -1],
          [-1, -1, 1],
        ],
      };
    case "d6": {
      const verts: V3[] = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) verts.push([x, y, z]);
      return { verts };
    }
    case "d8":
      return {
        verts: [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ],
      };
    case "d10": {
      // Pentagonal trapezohedron. The ring height makes every kite planar:
      // z0 = h (1 - cos 36°) / (1 + cos 36°).
      const h = 1;
      const c = Math.cos(Math.PI / 5);
      const z0 = (h * (1 - c)) / (1 + c);
      const stretch = 1.08; // a bit taller than the minimal shape, like real d10s
      const verts: V3[] = [
        [0, h * stretch, 0],
        [0, -h * stretch, 0],
      ];
      for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI) / 5;
        verts.push([Math.cos(a), (i % 2 === 0 ? z0 : -z0) * stretch, Math.sin(a)]);
      }
      return { verts, apex: new Set([0, 1]) };
    }
    case "d12": {
      const verts: V3[] = [];
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) verts.push([x, y, z]);
      const a = 1 / PHI;
      for (const s1 of [-1, 1])
        for (const s2 of [-1, 1]) {
          verts.push([0, s1 * a, s2 * PHI]);
          verts.push([s1 * a, s2 * PHI, 0]);
          verts.push([s1 * PHI, 0, s2 * a]);
        }
      return { verts };
    }
    case "d20": {
      const verts: V3[] = [];
      for (const s1 of [-1, 1])
        for (const s2 of [-1, 1]) {
          verts.push([0, s1, s2 * PHI]);
          verts.push([s1, s2 * PHI, 0]);
          verts.push([s1 * PHI, 0, s2]);
        }
      return { verts };
    }
    case "d24": {
      // Deltoidal icositetrahedron (dual of the rhombicuboctahedron): 24 kites.
      const verts: V3[] = [];
      const apex = new Set<number>();
      // 6 octahedral vertices: the long tip of every kite
      for (const s of [-1, 1]) {
        apex.add(verts.push([s, 0, 0]) - 1);
        apex.add(verts.push([0, s, 0]) - 1);
        apex.add(verts.push([0, 0, s]) - 1);
      }
      const r = Math.SQRT1_2;
      for (const s1 of [-1, 1])
        for (const s2 of [-1, 1]) {
          verts.push([0, s1 * r, s2 * r]);
          verts.push([s1 * r, 0, s2 * r]);
          verts.push([s1 * r, s2 * r, 0]);
        }
      const k = (1 + 2 * Math.SQRT2) / 7;
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) verts.push([x * k, y * k, z * k]);
      return { verts, apex };
    }
  }
}

/** Finds the faces of the convex hull of `verts` by enumerating supporting planes. */
function findFaces(verts: V3[]): { verts: number[]; normal: V3 }[] {
  const eps = 1e-6;
  const planes: { n: V3; d: number }[] = [];
  const faces: { verts: number[]; normal: V3 }[] = [];
  const N = verts.length;
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++)
      for (let k = j + 1; k < N; k++) {
        let n = vec.cross(vec.sub(verts[j], verts[i]), vec.sub(verts[k], verts[i]));
        if (vec.len(n) < 1e-9) continue;
        n = vec.norm(n);
        let d = vec.dot(n, verts[i]);
        let above = 0;
        let below = 0;
        for (const p of verts) {
          const s = vec.dot(n, p) - d;
          if (s > eps) above++;
          else if (s < -eps) below++;
          if (above && below) break;
        }
        if (above && below) continue;
        if (above) {
          n = vec.mul(n, -1);
          d = -d;
        }
        if (planes.some((p) => vec.dot(p.n, n) > 1 - 1e-7 && Math.abs(p.d - d) < 1e-6)) continue;
        planes.push({ n, d });
        const on: number[] = [];
        verts.forEach((p, idx) => {
          if (Math.abs(vec.dot(n, p) - d) < eps) on.push(idx);
        });
        // order counter-clockwise around the outward normal
        const c = vec.avg(on.map((idx) => verts[idx]));
        const a = vec.norm(vec.sub(verts[on[0]], c));
        const b = vec.cross(n, a);
        on.sort((p, q) => {
          const dp = vec.sub(verts[p], c);
          const dq = vec.sub(verts[q], c);
          return Math.atan2(vec.dot(dp, b), vec.dot(dp, a)) - Math.atan2(vec.dot(dq, b), vec.dot(dq, a));
        });
        faces.push({ verts: on, normal: n });
      }
  return faces;
}

/** Smallest signed distance from P to the edges of a CCW polygon (positive inside). */
function edgeClearance(P: V3, poly: V3[], n: V3): number {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const e = vec.norm(vec.sub(b, a));
    const inward = vec.cross(n, e);
    m = Math.min(m, vec.dot(vec.sub(P, a), inward));
  }
  return m;
}

const cache = new Map<SolidId, Solid>();

export function getSolid(id: SolidId): Solid {
  const hit = cache.get(id);
  if (hit) return hit;
  const raw = rawSolid(id);
  const maxR = Math.max(...raw.verts.map((p) => vec.len(p)));
  const s = TARGET_RADIUS[id] / maxR;
  const vertices = raw.verts.map((p) => vec.mul(p, s));
  const found = findFaces(vertices);

  const faces: Face[] = found.map((f) => {
    const poly = f.verts.map((i) => vertices[i]);
    const n = f.normal;
    let center: V3;
    let up: V3;
    const apexPos = raw.apex ? f.verts.findIndex((i) => raw.apex!.has(i)) : -1;
    if (apexPos >= 0 && poly.length === 4) {
      // Kite: the best label spot lies on the symmetry axis, between the
      // long tip and the opposite vertex. Clearance is concave along that line.
      const A = poly[apexPos];
      const D = poly[(apexPos + 2) % 4];
      let lo = 0;
      let hi = 1;
      for (let it = 0; it < 60; it++) {
        const m1 = lo + (hi - lo) / 3;
        const m2 = hi - (hi - lo) / 3;
        if (edgeClearance(vec.lerp(A, D, m1), poly, n) < edgeClearance(vec.lerp(A, D, m2), poly, n)) lo = m1;
        else hi = m2;
      }
      center = vec.lerp(A, D, (lo + hi) / 2);
      up = vec.norm(vec.sub(A, center));
    } else {
      center = vec.avg(poly);
      if (id === "coin") {
        up = vec.norm(vec.reject([1, 0, 0], n));
      } else if (poly.length % 2 === 1) {
        up = vec.norm(vec.sub(poly[0], center));
      } else {
        up = vec.norm(vec.sub(vec.lerp(poly[0], poly[1], 0.5), center));
      }
    }
    up = vec.norm(vec.reject(up, n));
    const inradius = edgeClearance(center, poly, n);
    const extent = Math.max(...poly.map((p) => vec.len(vec.sub(p, center))));
    return { verts: f.verts, normal: n, center, up, inradius, extent, opposite: -1 };
  });

  faces.forEach((f, i) => {
    f.opposite = faces.findIndex((g, j) => j !== i && vec.dot(f.normal, g.normal) < -0.9999);
  });

  let labelFaces = faces.map((_, i) => i);
  if (id === "coin") labelFaces = labelFaces.filter((i) => Math.abs(faces[i].normal[1]) > 0.99);

  const vertexFrames =
    id === "d4"
      ? vertices.map((p, i) => {
          const dir = vec.norm(p);
          const nb = vertices[(i + 1) % vertices.length];
          return { dir, ref: vec.norm(vec.reject(vec.sub(nb, p), dir)) };
        })
      : [];

  const solid: Solid = {
    id,
    vertices,
    faces,
    labelFaces,
    readMode: id === "d4" ? "vertex" : "face",
    vertexFrames,
    radius: TARGET_RADIUS[id],
    mass: MASS[id],
  };
  cache.set(id, solid);
  return solid;
}

/** Number of label slots of a solid: faces, or vertices for the d4. */
export function slotCount(solid: Solid): number {
  return solid.readMode === "vertex" ? solid.vertices.length : solid.labelFaces.length;
}

/**
 * Frame (unit x/up axis and unit z/normal axis) of a label slot, in body space.
 * Slots index `labelFaces` for face dice and vertices for the d4.
 */
export function slotFrame(solid: Solid, slot: number): { e1: V3; e3: V3 } {
  if (solid.readMode === "vertex") {
    const f = solid.vertexFrames[slot];
    return { e1: f.ref, e3: f.dir };
  }
  const face = solid.faces[solid.labelFaces[slot]];
  return { e1: face.up, e3: face.normal };
}

/** Body-space direction that must point up for a slot to be the result. */
export function slotDirection(solid: Solid, slot: number): V3 {
  return slotFrame(solid, slot).e3;
}

/**
 * Pairs every label slot with its opposite and orders the pairs, so labels can be
 * assigned like on real dice (opposite faces add up to n + 1).
 * Returns slot indices in label order: label k goes to result[k].
 */
export function labelOrder(solid: Solid): number[] {
  const n = slotCount(solid);
  if (solid.readMode === "vertex") return Array.from({ length: n }, (_, i) => i);
  const order = new Array<number>(n);
  const used = new Set<number>();
  // Walk faces sorted by a stable direction score so neighbours get spread labels.
  const slots = Array.from({ length: n }, (_, i) => i);
  const score = (slot: number) => {
    const f = solid.faces[solid.labelFaces[slot]].normal;
    return Math.atan2(f[2], f[0]) * 3 + f[1] * 7;
  };
  slots.sort((a, b) => score(a) - score(b));
  let k = 0;
  for (const slot of slots) {
    if (used.has(slot)) continue;
    const face = solid.faces[solid.labelFaces[slot]];
    const oppFace = face.opposite;
    const oppSlot = solid.labelFaces.indexOf(oppFace);
    if (oppSlot < 0 || used.has(oppSlot)) {
      // no opposite (should not happen for our solids): fill sequentially
      order[k++] = slot;
      used.add(slot);
      continue;
    }
    order[k] = slot;
    order[n - 1 - k] = oppSlot;
    used.add(slot);
    used.add(oppSlot);
    k++;
  }
  return order;
}

// ---------------------------------------------------------------------------
// Small quaternion helpers (x, y, z, w) used by physics, rigging and tests.

export type Quat = [number, number, number, number];

export function quatRotate(q: Quat, p: V3): V3 {
  const [x, y, z, w] = q;
  // t = 2 * cross(q.xyz, p)
  const tx = 2 * (y * p[2] - z * p[1]);
  const ty = 2 * (z * p[0] - x * p[2]);
  const tz = 2 * (x * p[1] - y * p[0]);
  return [p[0] + w * tx + (y * tz - z * ty), p[1] + w * ty + (z * tx - x * tz), p[2] + w * tz + (x * ty - y * tx)];
}

export function quatFromMatrix(m: number[][]): Quat {
  // m is row-major 3x3 rotation matrix
  const trace = m[0][0] + m[1][1] + m[2][2];
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (m[2][1] - m[1][2]) * s;
    y = (m[0][2] - m[2][0]) * s;
    z = (m[1][0] - m[0][1]) * s;
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]);
    w = (m[2][1] - m[1][2]) / s;
    x = 0.25 * s;
    y = (m[0][1] + m[1][0]) / s;
    z = (m[0][2] + m[2][0]) / s;
  } else if (m[1][1] > m[2][2]) {
    const s = 2 * Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]);
    w = (m[0][2] - m[2][0]) / s;
    x = (m[0][1] + m[1][0]) / s;
    y = 0.25 * s;
    z = (m[1][2] + m[2][1]) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]);
    w = (m[1][0] - m[0][1]) / s;
    x = (m[0][2] + m[2][0]) / s;
    y = (m[1][2] + m[2][1]) / s;
    z = 0.25 * s;
  }
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

/**
 * Rotation (body space) that carries label slot `from` onto slot `to`.
 * It is a symmetry of the solid, so a mesh rotated by it occupies exactly the
 * same space: the physics body does not change, only which label sits where.
 */
export function symmetryBetween(solid: Solid, from: number, to: number): Quat {
  const a = slotFrame(solid, from);
  const b = slotFrame(solid, to);
  const basis = (f: { e1: V3; e3: V3 }) => {
    const e2 = vec.cross(f.e3, f.e1);
    return [f.e1, e2, f.e3];
  };
  const A = basis(a); // columns of B_from
  const B = basis(b); // columns of B_to
  // R = B_to * B_from^T  =>  R[i][j] = sum_k B[k][i] * A[k][j]
  const R: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += B[k][i] * A[k][j];
      R[i][j] = s;
    }
  return quatFromMatrix(R);
}
