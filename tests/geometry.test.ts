import { describe, expect, it } from "vitest";
import {
  SOLID_IDS,
  type V3,
  getSolid,
  labelOrder,
  quatRotate,
  slotCount,
  slotDirection,
  symmetryBetween,
  vec,
} from "@/lib/dice/geometry";

const EXPECTED_FACES: Record<string, number> = { coin: 26, d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d24: 24 };
const EXPECTED_SLOTS: Record<string, number> = { coin: 2, d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20, d24: 24 };

describe("solids", () => {
  for (const id of SOLID_IDS) {
    const solid = getSolid(id);

    it(`${id} has the right faces and slots`, () => {
      expect(solid.faces.length).toBe(EXPECTED_FACES[id]);
      expect(slotCount(solid)).toBe(EXPECTED_SLOTS[id]);
    });

    it(`${id} faces are planar, convex and point outwards`, () => {
      for (const f of solid.faces) {
        const d = vec.dot(f.normal, solid.vertices[f.verts[0]]);
        expect(d).toBeGreaterThan(0);
        for (const vi of f.verts) expect(Math.abs(vec.dot(f.normal, solid.vertices[vi]) - d)).toBeLessThan(1e-6);
        for (const p of solid.vertices) expect(vec.dot(f.normal, p)).toBeLessThanOrEqual(d + 1e-6);
        // CCW winding: polygon normal from cross products agrees with outward normal
        const a = solid.vertices[f.verts[0]];
        const b = solid.vertices[f.verts[1]];
        const c = solid.vertices[f.verts[2]];
        expect(vec.dot(vec.cross(vec.sub(b, a), vec.sub(c, a)), f.normal)).toBeGreaterThan(0);
        expect(f.inradius).toBeGreaterThan(0.05);
        expect(Math.abs(vec.dot(f.up, f.normal))).toBeLessThan(1e-9);
      }
    });

    it(`${id} label order pairs opposite faces`, () => {
      const order = labelOrder(solid);
      expect(new Set(order).size).toBe(slotCount(solid));
      if (solid.readMode === "face") {
        const n = order.length;
        for (let k = 0; k < n; k++) {
          const a = slotDirection(solid, order[k]);
          const b = slotDirection(solid, order[n - 1 - k]);
          expect(vec.dot(a, b)).toBeLessThan(-0.999);
        }
      }
    });

    it(`${id} slot-to-slot rotations are symmetries`, () => {
      const n = slotCount(solid);
      const key = (p: V3) => p.map((x) => (Math.abs(x) < 5e-5 ? 0 : x).toFixed(4)).join(",");
      const set = new Set(solid.vertices.map(key));
      for (let a = 0; a < n; a++)
        for (let b = 0; b < n; b++) {
          const q = symmetryBetween(solid, a, b);
          // maps slot a's direction onto slot b's
          const d = quatRotate(q, slotDirection(solid, a));
          expect(vec.dot(d, slotDirection(solid, b))).toBeGreaterThan(0.99999);
          // and the vertex set onto itself
          for (const p of solid.vertices) {
            const r = quatRotate(q, p);
            expect(set.has(key(r))).toBe(true);
          }
        }
    });
  }
});
