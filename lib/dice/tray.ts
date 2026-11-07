import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { getSolid, symmetryBetween } from "./geometry";
import { type DieLook, dieMaterial, disposeDiceResources, solidGeometry } from "./mesh";
import type { Part } from "./models";
import { type Bounds, type Hit, type SimResult, simulateThrow } from "./physics";

export interface TrayDie {
  part: Part;
  look: DieLook;
  /** Label slot that has to end on top. */
  slot: number;
  /** Shown faded once the throw lands (dropped by keep/drop rules). */
  dropped?: boolean;
}

export interface TrayThrow {
  id: string;
  seed: number;
  dice: TrayDie[];
  /** Called when this throw actually starts (it may wait in a queue). */
  onStart?: () => void;
}

interface Playing {
  spec: TrayThrow;
  sim: SimResult;
  groups: THREE.Group[];
  start: number;
  speed: number;
  resolve: () => void;
}

interface Fading {
  groups: THREE.Group[];
  start: number;
}

const FLOOR_COLOR = "#2b3446";
const tmpQ = [0, 0, 0, 1];

function woolTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = FLOOR_COLOR;
  g.fillRect(0, 0, size, size);
  // woven threads: alternating over/under bands with soft noise
  const step = 8;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const over = ((x + y) / step) % 2 === 0;
      const l = over ? 0.055 : -0.04;
      g.fillStyle = l > 0 ? `rgba(220,230,255,${l})` : `rgba(0,0,0,${-l})`;
      if (over) g.fillRect(x, y + 1, step, step - 2);
      else g.fillRect(x + 1, y, step - 2, step);
    }
  }
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class DiceTray {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.5, 200);
  private root = new THREE.Group();
  private sun: THREE.DirectionalLight;
  private bounds: Bounds = { hx: 8, hz: 6 };
  private queue: { spec: TrayThrow; resolve: () => void }[] = [];
  private current: Playing | null = null;
  private resting: THREE.Group[] = [];
  private fading: Fading[] = [];
  private raf = 0;
  private resizeObs: ResizeObserver;
  private audio: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private disposed = false;
  muted = false;
  /** Screen pixels at the bottom of the tray where dice should not come to rest. */
  reserveBottomPx = 78;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(FLOOR_COLOR);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    const floorTex = woolTexture();
    floorTex.repeat.set(26, 26);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 120),
      new THREE.MeshStandardMaterial({ color: "#ffffff", map: floorTex, roughness: 0.96, metalness: 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.scene.add(new THREE.HemisphereLight("#dfe8f5", "#3a2c22", 0.85));
    this.sun = new THREE.DirectionalLight("#fff1dc", 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(this.root);

    this.resizeObs = new ResizeObserver(() => this.layout());
    this.resizeObs.observe(container);
    this.layout();
    void this.warmUp();
  }

  /**
   * Compiles the dice shader before the first throw, so the first roll does not
   * stall while the GPU driver builds it (noticeable on Windows).
   */
  private async warmUp() {
    try {
      const { physicalModel } = await import("./models");
      const model = physicalModel({ type: "std", sides: 20 });
      if (!model || this.disposed) return;
      const part = model.parts[0];
      const probe = new THREE.Mesh(solidGeometry(part.solid), dieMaterial(part, { base: "#b8402f", label: "#f6f1e7" }));
      probe.position.set(0, -50, 0);
      probe.castShadow = true;
      this.scene.add(probe);
      await this.renderer.compileAsync(this.scene, this.camera);
      this.scene.remove(probe);
    } catch {
      /* warming up is only an optimisation */
    }
  }

  /** Fits camera, walls and light to the container size. */
  private layout() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    const unitPx = Math.min(36, Math.max(16, Math.min(w, h) / 15));
    const fov = 30;
    const tilt = 0.17;
    this.camera.fov = fov;
    this.camera.aspect = w / h;
    const halfH = h / 2 / unitPx;
    const dist = halfH / Math.tan(THREE.MathUtils.degToRad(fov / 2));
    this.camera.position.set(0, dist * Math.cos(tilt), dist * Math.sin(tilt));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    // visible floor: intersect the frustum corners with y = 0, keep the inner rectangle
    const hitFloor = (nx: number, ny: number) => {
      const p = new THREE.Vector3(nx, ny, 0.5).unproject(this.camera);
      const dir = p.sub(this.camera.position).normalize();
      const t = -this.camera.position.y / dir.y;
      return this.camera.position.clone().addScaledVector(dir, t);
    };
    // keep a band at the bottom free for the result card
    const reserve = Math.min(0.3, (2 * this.reserveBottomPx) / h);
    const bl = hitFloor(-1, -1 + reserve);
    const br = hitFloor(1, -1 + reserve);
    const tl = hitFloor(-1, 1);
    const tr = hitFloor(1, 1);
    const minX = Math.max(bl.x, tl.x);
    const maxX = Math.min(br.x, tr.x);
    const minZ = Math.max(tl.z, tr.z);
    const maxZ = Math.min(bl.z, br.z);
    const margin = 0.25;
    this.bounds = { hx: (maxX - minX) / 2 - margin, hz: (maxZ - minZ) / 2 - margin };
    this.root.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);

    const ext = Math.max(this.bounds.hx, this.bounds.hz) + 3;
    this.sun.position.set(this.root.position.x - ext * 0.45, 30, this.root.position.z + ext * 0.35);
    this.sun.target.position.copy(this.root.position);
    const cam = this.sun.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 5;
    cam.far = 60;
    cam.updateProjectionMatrix();
    this.requestRender();
  }

  get size() {
    return { ...this.bounds };
  }

  /** Throws dice; resolves once they come to rest showing the requested faces. */
  throw(spec: TrayThrow): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ spec, resolve });
      if (this.current) this.current.speed = Math.max(this.current.speed, 1.8);
      if (!this.current) this.startNext();
    });
  }

  clear() {
    this.queue.forEach((q) => q.resolve());
    this.queue = [];
    if (this.current) {
      this.current.resolve();
      this.fadeOut(this.current.groups);
      this.current = null;
    }
    this.fadeOut(this.resting);
    this.resting = [];
  }

  private fadeOut(groups: THREE.Group[]) {
    if (!groups.length) return;
    this.fading.push({ groups, start: performance.now() });
    this.requestRender();
  }

  private startNext() {
    const next = this.queue.shift();
    if (!next) return;
    const { spec, resolve } = next;
    spec.onStart?.();
    if (!spec.dice.length) {
      resolve();
      this.startNext();
      return;
    }
    this.fadeOut(this.resting);
    this.resting = [];

    const sim = simulateThrow({ solids: spec.dice.map((d) => d.part.solid), bounds: this.bounds, seed: spec.seed });
    const groups = spec.dice.map((d, i) => {
      const solid = getSolid(d.part.solid);
      const mesh = new THREE.Mesh(solidGeometry(d.part.solid), dieMaterial(d.part, d.look));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const q = symmetryBetween(solid, d.slot, sim.landed[i]);
      mesh.quaternion.set(q[0], q[1], q[2], q[3]);
      const g = new THREE.Group();
      g.add(mesh);
      g.userData.die = d;
      this.root.add(g);
      return g;
    });
    this.current = { spec, sim, groups, start: performance.now(), speed: this.queue.length ? 1.6 : 1, resolve };
    this.applyFrame(this.current, 0);
    this.playHits(sim.hits, this.current.speed);
    this.requestRender();
  }

  private applyFrame(p: Playing, f: number) {
    const { frames, frameCount } = p.sim;
    const i0 = Math.min(frameCount - 1, Math.floor(f));
    const i1 = Math.min(frameCount - 1, i0 + 1);
    const a = Math.min(1, Math.max(0, f - i0));
    p.groups.forEach((g, k) => {
      const fr = frames[k];
      const o0 = i0 * 7;
      const o1 = i1 * 7;
      g.position.set(
        fr[o0] + (fr[o1] - fr[o0]) * a,
        fr[o0 + 1] + (fr[o1 + 1] - fr[o0 + 1]) * a,
        fr[o0 + 2] + (fr[o1 + 2] - fr[o0 + 2]) * a,
      );
      THREE.Quaternion.slerpFlat(tmpQ, 0, fr as unknown as number[], o0 + 3, fr as unknown as number[], o1 + 3, a);
      g.quaternion.set(tmpQ[0], tmpQ[1], tmpQ[2], tmpQ[3]);
    });
  }

  private finish(p: Playing) {
    this.applyFrame(p, p.sim.frameCount - 1);
    p.groups.forEach((g) => {
      const d = g.userData.die as TrayDie;
      if (d.dropped) {
        const mesh = g.children[0] as THREE.Mesh;
        mesh.material = dieMaterial(d.part, d.look, true);
      }
    });
    this.resting = p.groups;
    this.current = null;
    p.resolve();
    if (this.queue.length) setTimeout(() => !this.disposed && this.startNext(), 380);
  }

  private requestRender() {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    let more = false;
    const p = this.current;
    if (p) {
      const f = ((now - p.start) / 1000) * p.sim.fps * p.speed;
      if (f >= p.sim.frameCount - 1) this.finish(p);
      else {
        this.applyFrame(p, f);
        more = true;
      }
    }
    this.fading = this.fading.filter((fd) => {
      const t = (now - fd.start) / 320;
      if (t >= 1) {
        fd.groups.forEach((g) => this.root.remove(g));
        return false;
      }
      const s = 1 - t * t;
      fd.groups.forEach((g) => {
        g.scale.setScalar(Math.max(0.001, s));
        g.position.y = Math.max(g.position.y - 0.04, 0);
      });
      more = true;
      return true;
    });
    this.renderer.render(this.scene, this.camera);
    if (more || this.current) this.requestRender();
  };

  // --- sound: short filtered noise bursts at each recorded collision -------

  private ensureAudio(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    try {
      if (!this.audio) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return null;
        this.audio = new Ctx();
        const len = Math.floor(this.audio.sampleRate * 0.08);
        this.noise = this.audio.createBuffer(1, len, this.audio.sampleRate);
        const ch = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      }
      if (this.audio.state === "suspended") void this.audio.resume();
      return this.audio;
    } catch {
      return null;
    }
  }

  /** Call from a user gesture so later (remote) throws can play sound. */
  unlockAudio() {
    this.ensureAudio();
  }

  private playHits(hits: Hit[], speed: number) {
    const ctx = this.ensureAudio();
    if (!ctx || !this.noise || ctx.state !== "running") return;
    const t0 = ctx.currentTime + 0.03;
    let played = 0;
    for (const h of hits) {
      if (played > 48) break;
      played++;
      const at = t0 + h.t / speed;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 0.8 + Math.random() * 0.5;
      const filter = ctx.createBiquadFilter();
      filter.type = h.k === 2 ? "bandpass" : "lowpass";
      filter.frequency.value = h.k === 2 ? 2600 + Math.random() * 1400 : h.k === 1 ? 1500 : 700 + Math.random() * 300;
      filter.Q.value = h.k === 2 ? 3 : 0.8;
      const gain = ctx.createGain();
      const vol = Math.min(1, h.v / 22) * (h.k === 2 ? 0.55 : 0.9);
      gain.gain.setValueAtTime(vol, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + (h.k === 2 ? 0.05 : 0.09));
      src.connect(filter).connect(gain).connect(ctx.destination);
      src.start(at);
      src.stop(at + 0.1);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.queue.forEach((q) => q.resolve());
    this.current?.resolve();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    void this.audio?.close();
    disposeDiceResources();
  }
}
