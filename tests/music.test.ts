import { describe, expect, it } from "vitest";
import { type Faixa, type SomState, applyLocal, currentPosition, formatTime, newerSound, parseMusicLink } from "@/lib/music";

const ok = (link: string) => {
  const r = parseMusicLink(link);
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe("parseMusicLink", () => {
  it("understands the usual YouTube links", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RD",
    ]) {
      expect(ok(link).faixa).toEqual({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", tipo: "youtube", youtube_id: "dQw4w9WgXcQ" });
    }
  });

  it("explains what it cannot play", () => {
    expect(parseMusicLink("")).toMatchObject({ ok: false });
    expect(parseMusicLink("https://www.youtube.com/playlist?list=PL123")).toMatchObject({ ok: false, error: expect.stringMatching(/playlist/) });
    expect(parseMusicLink("https://open.spotify.com/track/abc")).toMatchObject({ ok: false, error: expect.stringMatching(/Spotify/) });
    expect(parseMusicLink("https://youtu.be/curto")).toMatchObject({ ok: false });
    expect(parseMusicLink("ftp://exemplo.com/a.mp3")).toMatchObject({ ok: false });
  });

  it("plays direct audio links and suggests a title from the file name", () => {
    const r = ok("https://exemplo.com/trilhas/Taverna_do-Javali.mp3?v=2");
    expect(r.faixa.tipo).toBe("audio");
    expect(r.tituloSugerido).toBe("Taverna do Javali");
  });

  it("turns Dropbox and Google Drive share links into direct downloads", () => {
    expect(ok("https://www.dropbox.com/s/abc/chuva.mp3?dl=0").faixa.url).toBe("https://www.dropbox.com/s/abc/chuva.mp3?raw=1");
    expect(ok("https://drive.google.com/file/d/1AbC_dEf/view?usp=sharing").faixa.url).toBe("https://drive.google.com/uc?export=download&id=1AbC_dEf");
    expect(parseMusicLink("https://drive.google.com/drive/folders")).toMatchObject({ ok: false });
  });
});

describe("table clock", () => {
  it("advances only while playing", () => {
    const t0 = Date.parse("2026-11-07T20:00:00Z");
    const s = { tocando: true, posicao: 10, iniciado_em: new Date(t0).toISOString() };
    expect(currentPosition(s, t0 + 2500)).toBeCloseTo(12.5);
    expect(currentPosition({ ...s, tocando: false }, t0 + 2500)).toBe(10);
  });

  it("formats times", () => {
    expect([0, 59.9, 61, 3725].map(formatTime)).toEqual(["0:00", "0:59", "1:01", "1:02:05"]);
    expect(formatTime(Number.NaN)).toBe("--:--");
  });
});

describe("applyLocal (same rules as som_controlar)", () => {
  const track = (n: number): Faixa => ({ titulo: `Faixa ${n}`, url: `https://exemplo.com/${n}.mp3`, tipo: "audio" });
  const t0 = Date.parse("2026-11-07T20:00:00Z");

  it("keeps time while paused and walks the queue", () => {
    let s = applyLocal(null, "musica", "tocar", { fila: [track(1), track(2), track(3)], idx: 1 }, t0);
    expect(s).toMatchObject({ tocando: true, fila_idx: 1, faixa: { titulo: "Faixa 2" }, repetir: false, versao: 1 });
    s = applyLocal(s, "musica", "pausar", {}, t0 + 5000);
    expect(s).toMatchObject({ tocando: false, posicao: 5 });
    s = applyLocal(s, "musica", "continuar", {}, t0 + 9000);
    expect(currentPosition(s, t0 + 10000)).toBeCloseTo(6);
    s = applyLocal(s, "musica", "anterior", {}, t0 + 10000);
    expect(s).toMatchObject({ fila_idx: 1, posicao: 0 }); // past 4 s: back to the start of the same track
    s = applyLocal(s, "musica", "anterior", {}, t0 + 11000);
    expect(s.fila_idx).toBe(0);
    s = applyLocal(s, "musica", "proxima", {}, t0 + 12000);
    s = applyLocal(s, "musica", "proxima", {}, t0 + 13000);
    expect(s.fila_idx).toBe(2);
    s = applyLocal(s, "musica", "proxima", { fim: true }, t0 + 14000);
    expect(s).toMatchObject({ tocando: false, fila_idx: 0 });
    expect(s.versao).toBe(8);
  });

  it("loops ambience by default and stops cleanly", () => {
    let s = applyLocal(null, "ambiente", "tocar", { faixa: track(9) }, t0);
    expect(s).toMatchObject({ repetir: true, fila: [track(9)] });
    s = applyLocal(s, "ambiente", "proxima", { fim: true }, t0 + 1000);
    expect(s).toMatchObject({ tocando: true, fila_idx: 0 });
    s = applyLocal(s, "ambiente", "parar", {}, t0 + 2000);
    expect(s).toMatchObject({ tocando: false, faixa: null, fila: [] });
  });
});

describe("newerSound", () => {
  const base = { canal: "musica", faixa: null, fila: [], fila_idx: 0, tocando: false, posicao: 0, iniciado_em: "", repetir: false, volume: 1 } satisfies SomState;
  it("never lets a late update replace a newer one", () => {
    const v3 = { ...base, versao: 3, tocando: true };
    const v2 = { ...base, versao: 2 };
    expect(newerSound(v3, v2)).toBe(v3);
    expect(newerSound(v2, v3)).toBe(v3);
    expect(newerSound(undefined, v2)).toBe(v2);
  });
});
