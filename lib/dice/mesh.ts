import * as THREE from "three";
import { type Solid, type SolidId, type V3, getSolid, vec } from "./geometry";
import type { Part } from "./models";
import { RUNE_BY_KEY } from "./runes";

/**
 * Rendering side of the dice: bevelled geometry with UVs into a label atlas,
 * the atlas itself (drawn on a canvas) and the materials.
 *
 * Labels live in a grey-scale mask texture (white label on black); the shader
 * mixes the die colour and the label colour with it, so one atlas serves every
 * player colour.
 */

const ATLAS_SIZE = 1024;
export const LABEL_FONT = '"Schibsted Grotesk Variable", "Schibsted Grotesk", system-ui, sans-serif';

interface Layout {
  grid: number;
  /** World units → atlas pixels for each face. */
  pxPerUnit: number[];
}

const BEVEL: Record<SolidId, number> = {
  coin: 0.06,
  d4: 0.07,
  d6: 0.1,
  d8: 0.075,
  d10: 0.07,
  d12: 0.075,
  d20: 0.065,
  d24: 0.06,
};

function cellCount(solid: Solid) {
  return solid.faces.length + 1; // every face gets a cell (rim faces stay blank) + a blank cell
}

function layoutFor(solid: Solid): Layout {
  const grid = Math.ceil(Math.sqrt(cellCount(solid)));
  const cell = ATLAS_SIZE / grid;
  return {
    grid,
    pxPerUnit: solid.faces.map((f) => (cell * 0.5) / (f.extent * 1.04)),
  };
}

function cellCenterUV(grid: number, index: number): [number, number] {
  const col = index % grid;
  const row = Math.floor(index / grid);
  return [(col + 0.5) / grid, 1 - (row + 0.5) / grid];
}

const geometryCache = new Map<SolidId, THREE.BufferGeometry>();

/** Bevelled, non-indexed geometry for a solid with atlas UVs. */
export function solidGeometry(id: SolidId): THREE.BufferGeometry {
  const hit = geometryCache.get(id);
  if (hit) return hit;
  const solid = getSolid(id);
  const layout = layoutFor(solid);
  const w = BEVEL[id] * solid.radius;
  const blankUV = cellCenterUV(layout.grid, cellCount(solid) - 1);
  const labelSet = new Set(solid.labelFaces);

  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const pushV = (p: V3, n: V3, t: [number, number]) => {
    pos.push(p[0], p[1], p[2]);
    nor.push(n[0], n[1], n[2]);
    uv.push(t[0], t[1]);
  };

  // 1. inset every face polygon by a constant width (true polygon offset)
  const inset: Map<number, V3>[] = solid.faces.map((f) => {
    const m = new Map<number, V3>();
    const pts = f.verts.map((i) => solid.vertices[i]);
    const n = f.normal;
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k];
      const prev = pts[(k - 1 + pts.length) % pts.length];
      const next = pts[(k + 1) % pts.length];
      const nin = vec.cross(n, vec.norm(vec.sub(p, prev)));
      const nout = vec.cross(n, vec.norm(vec.sub(next, p)));
      const c = vec.dot(nin, nout);
      m.set(f.verts[k], vec.add(p, vec.mul(vec.add(nin, nout), w / (1 + c))));
    }
    return m;
  });

  // 2. face polygons (fan from the label centre keeps UVs exact)
  solid.faces.forEach((f, fi) => {
    const n = f.normal;
    const right = vec.cross(f.up, n);
    const toUV = (p: V3): [number, number] => {
      if (!labelSet.has(fi)) return blankUV;
      const d = vec.sub(p, f.center);
      const [cu, cv] = cellCenterUV(layout.grid, fi);
      const s = layout.pxPerUnit[fi] / ATLAS_SIZE;
      return [cu + vec.dot(d, right) * s, cv + vec.dot(d, f.up) * s];
    };
    const ring = f.verts.map((vi) => inset[fi].get(vi)!);
    const c = f.center;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      pushV(c, n, toUV(c));
      pushV(a, n, toUV(a));
      pushV(b, n, toUV(b));
    }
  });

  const tri = (a: V3, an: V3, b: V3, bn: V3, c: V3, cn: V3) => {
    // keep outward winding on a convex solid centred at the origin
    const nrm = vec.cross(vec.sub(b, a), vec.sub(c, a));
    const mid = vec.avg([a, b, c]);
    if (vec.dot(nrm, mid) < 0) {
      pushV(a, an, blankUV);
      pushV(c, cn, blankUV);
      pushV(b, bn, blankUV);
    } else {
      pushV(a, an, blankUV);
      pushV(b, bn, blankUV);
      pushV(c, cn, blankUV);
    }
  };

  // 3. bevel strips along every edge
  const edgeOwner = new Map<string, number>();
  solid.faces.forEach((f, fi) => {
    for (let k = 0; k < f.verts.length; k++) {
      const a = f.verts[k];
      const b = f.verts[(k + 1) % f.verts.length];
      edgeOwner.set(`${a}>${b}`, fi);
    }
  });
  solid.faces.forEach((f, fi) => {
    for (let k = 0; k < f.verts.length; k++) {
      const a = f.verts[k];
      const b = f.verts[(k + 1) % f.verts.length];
      const gi = edgeOwner.get(`${b}>${a}`);
      if (gi === undefined || gi < fi) continue;
      const g = solid.faces[gi];
      const fa = inset[fi].get(a)!;
      const fb = inset[fi].get(b)!;
      const ga = inset[gi].get(a)!;
      const gb = inset[gi].get(b)!;
      tri(fa, f.normal, fb, f.normal, gb, g.normal);
      tri(fa, f.normal, gb, g.normal, ga, g.normal);
    }
  });

  // 4. corner caps around every original vertex
  solid.vertices.forEach((p, vi) => {
    const around: { pt: V3; n: V3 }[] = [];
    solid.faces.forEach((f, fi) => {
      if (f.verts.includes(vi)) around.push({ pt: inset[fi].get(vi)!, n: f.normal });
    });
    if (around.length < 3) return;
    const axis = vec.norm(p);
    const center = vec.avg(around.map((x) => x.pt));
    const a0 = vec.norm(vec.reject(vec.sub(around[0].pt, center), axis));
    const b0 = vec.cross(axis, a0);
    around.sort((x, y) => {
      const dx = vec.sub(x.pt, center);
      const dy = vec.sub(y.pt, center);
      return Math.atan2(vec.dot(dx, b0), vec.dot(dx, a0)) - Math.atan2(vec.dot(dy, b0), vec.dot(dy, a0));
    });
    const cn = vec.norm(vec.avg(around.map((x) => x.n)));
    for (let k = 0; k < around.length; k++) {
      const x = around[k];
      const y = around[(k + 1) % around.length];
      tri(center, cn, x.pt, x.n, y.pt, y.n);
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.computeBoundingSphere();
  geometryCache.set(id, geo);
  return geo;
}

// ---------------------------------------------------------------------------
// Label atlas

function drawRune(ctx: CanvasRenderingContext2D, key: string, cx: number, cy: number, r: number) {
  const rune = RUNE_BY_KEY[key];
  if (!rune) return;
  const h = r * 1.3;
  const wd = h * 0.78;
  ctx.save();
  ctx.translate(cx - wd / 2, cy - h / 2);
  ctx.lineWidth = r * 0.15;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#fff";
  for (const s of rune.strokes) {
    ctx.beginPath();
    for (let i = 0; i < s.length; i += 2) {
      const x = s[i] * wd;
      const y = s[i + 1] * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawText(
  ctx: CanvasRenderingContext2D,
  label: string,
  cx: number,
  cy: number,
  r: number,
  angle: number,
  underline: boolean,
) {
  const text = label.trim();
  if (!text) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  // size: fit the label inside the inscribed circle
  let size = r * 1.25;
  ctx.font = `800 ${size}px ${LABEL_FONT}`;
  let m = ctx.measureText(text);
  const maxW = r * (text.length > 2 ? 1.75 : 1.5);
  if (m.width > maxW) {
    size *= maxW / m.width;
    ctx.font = `800 ${size}px ${LABEL_FONT}`;
    m = ctx.measureText(text);
  }
  const ascent = m.actualBoundingBoxAscent || size * 0.72;
  const descent = m.actualBoundingBoxDescent || 0;
  const y = (ascent - descent) / 2;
  ctx.fillText(text, 0, y);
  if (underline) {
    const uw = Math.max(m.width * 0.7, size * 0.38);
    ctx.fillRect(-uw / 2, y + size * 0.1, uw, size * 0.09);
  }
  ctx.restore();
}

const atlasCache = new Map<string, THREE.CanvasTexture>();

export function partAtlas(part: Part): THREE.CanvasTexture {
  const hit = atlasCache.get(part.atlasKey);
  if (hit) return hit;
  const solid = getSolid(part.solid);
  const layout = layoutFor(solid);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const cell = ATLAS_SIZE / layout.grid;
  const hasNine = part.labelsBySlot.some((l) => l.trim() === "9");

  if (solid.readMode === "vertex") {
    // d4: every face shows, near each corner, the value of that corner
    solid.faces.forEach((f, fi) => {
      const col = fi % layout.grid;
      const row = Math.floor(fi / layout.grid);
      const cx = (col + 0.5) * cell;
      const cy = (row + 0.5) * cell;
      const ppu = layout.pxPerUnit[fi];
      const right = vec.cross(f.up, f.normal);
      for (const vi of f.verts) {
        const d = vec.sub(solid.vertices[vi], f.center);
        const lx = vec.dot(d, right) * 0.56;
        const ly = vec.dot(d, f.up) * 0.56;
        const px = cx + lx * ppu;
        const py = cy - ly * ppu;
        const angle = Math.atan2(lx, ly);
        drawText(ctx, part.labelsBySlot[vi], px, py, f.inradius * ppu * 0.48, angle, false);
      }
    });
  } else {
    solid.labelFaces.forEach((fi, slot) => {
      const f = solid.faces[fi];
      const col = fi % layout.grid;
      const row = Math.floor(fi / layout.grid);
      const cx = (col + 0.5) * cell;
      const cy = (row + 0.5) * cell;
      const r = f.inradius * layout.pxPerUnit[fi] * 0.86;
      const label = part.labelsBySlot[slot];
      if (part.glyph === "rune") drawRune(ctx, label, cx, cy, r);
      else drawText(ctx, label, cx, cy, r, 0, hasNine && (label === "6" || label === "9"));
    });
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  atlasCache.set(part.atlasKey, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Materials

export interface DieLook {
  base: string;
  label: string;
  glow?: string;
  /** Stone/bone finish instead of resin. */
  matte?: boolean;
}

const materialCache = new Map<string, THREE.MeshPhysicalMaterial>();

export function dieMaterial(part: Part, look: DieLook, dim = false): THREE.MeshPhysicalMaterial {
  const key = `${part.atlasKey}#${look.base}#${look.label}#${look.glow ?? ""}#${look.matte ? 1 : 0}#${dim ? 1 : 0}`;
  const hit = materialCache.get(key);
  if (hit) return hit;
  const atlas = partAtlas(part);
  const base = new THREE.Color(look.base);
  const label = new THREE.Color(look.label);
  const glow = new THREE.Color(look.glow ?? "#000000");
  if (dim) {
    const grey = new THREE.Color("#5b6270");
    base.lerp(grey, 0.65);
    label.lerp(grey, 0.6);
    glow.multiplyScalar(0.15);
  }
  const mat = new THREE.MeshPhysicalMaterial({
    color: base,
    map: atlas,
    bumpMap: atlas,
    bumpScale: -1.4,
    roughness: look.matte ? 0.78 : 0.32,
    metalness: 0,
    clearcoat: look.matte ? 0 : 0.55,
    clearcoatRoughness: 0.28,
    transparent: dim,
    opacity: dim ? 0.82 : 1,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLabel = { value: label };
    shader.uniforms.uGlow = { value: glow };
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uLabel;\nuniform vec3 uGlow;")
      .replace(
        "#include <map_fragment>",
        `float labelMask = 0.0;
#ifdef USE_MAP
  labelMask = texture2D( map, vMapUv ).r;
  diffuseColor.rgb = mix( diffuseColor.rgb, uLabel, labelMask );
#endif`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\n  totalEmissiveRadiance += uGlow * labelMask;",
      );
  };
  mat.customProgramCacheKey = () => "runa-die";
  materialCache.set(key, mat);
  return mat;
}

/** Picks a readable label colour for a die colour. */
export function labelColorFor(hex: string): string {
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; // linear
  return lum > 0.32 ? "#1d1a17" : "#f6f1e7";
}

export function shadeHex(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const target = new THREE.Color(amount < 0 ? "#000000" : "#ffffff");
  c.lerp(target, Math.abs(amount));
  return `#${c.getHexString()}`;
}

/** Releases cached GPU resources (used when the tray is unmounted). */
export function disposeDiceResources() {
  materialCache.forEach((m) => m.dispose());
  materialCache.clear();
  atlasCache.forEach((t) => t.dispose());
  atlasCache.clear();
  geometryCache.forEach((g) => g.dispose());
  geometryCache.clear();
}
