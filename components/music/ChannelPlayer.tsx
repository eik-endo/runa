"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { type SomState, currentPosition } from "@/lib/music";
import { YT_ERRORS, type YTPlayer, loadYouTube } from "@/lib/youtube";

export interface ChannelStatus {
  blocked: boolean;
  error: string | null;
  duration: number | null;
  position: number;
}

export interface ChannelHandle {
  /** Call from a click: starts sound the browser refused to autoplay. */
  unlock(): void;
}

interface Props {
  state: SomState | null;
  /** Server clock minus local clock, in ms. */
  skewMs: number;
  /** Effective volume 0..1. */
  volume: number;
  /** The game master's browser reports when a track ends, to advance the queue. */
  controller: boolean;
  onEnded?: () => void;
  onStatus?: (s: ChannelStatus) => void;
  width: number;
  height: number;
}

/**
 * Plays one sound channel of a table and keeps it in step with the shared
 * state: YouTube through the IFrame API (the small video stays visible), any
 * other link through an <audio> element.
 */
export const ChannelPlayer = forwardRef<ChannelHandle, Props>(function ChannelPlayer(
  { state, skewMs, volume, controller, onEnded, onStatus, width, height },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const yt = useRef<YTPlayer | null>(null);
  const ytReady = useRef(false);
  const ytVideo = useRef<string | null>(null);
  const ytPlayAsked = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const audioSrc = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const skewRef = useRef(skewMs);
  skewRef.current = skewMs;
  const volRef = useRef(volume);
  volRef.current = volume;
  const ctlRef = useRef({ controller, onEnded });
  ctlRef.current = { controller, onEnded };
  const endedFor = useRef("");
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  const loopOne = (s: SomState) => s.repetir && s.fila.length <= 1;
  const instanceKey = (s: SomState) => `${s.fila_idx}|${s.iniciado_em}|${s.faixa?.url ?? ""}`;

  const reportEnded = useCallback(() => {
    const s = stateRef.current;
    if (!s || !ctlRef.current.controller) return;
    const key = instanceKey(s);
    if (endedFor.current === key) return;
    endedFor.current = key;
    ctlRef.current.onEnded?.();
  }, []);

  const expected = (s: SomState, duration: number | null) => {
    let pos = currentPosition(s, Date.now() + skewRef.current);
    if (loopOne(s) && duration && duration > 0) pos %= duration;
    return pos;
  };

  const sync = useCallback(() => {
    const s = stateRef.current;
    const f = s?.faixa ?? null;
    if (!s || !f) {
      if (audio.current && !audio.current.paused) audio.current.pause();
      if (audio.current && audioSrc.current) {
        audio.current.removeAttribute("src");
        audio.current.load();
        audioSrc.current = null;
      }
      if (yt.current && ytReady.current && ytVideo.current) {
        try {
          yt.current.stopVideo();
        } catch {
          /* player gone */
        }
        ytVideo.current = null;
      }
      return;
    }

    if (f.tipo === "youtube" && f.youtube_id) {
      if (audio.current && !audio.current.paused) audio.current.pause();
      const p = yt.current;
      if (!p || !ytReady.current) return;
      const dur = p.getDuration?.() || null;
      const pos = expected(s, dur);
      if (ytVideo.current !== f.youtube_id) {
        ytVideo.current = f.youtube_id;
        setError(null);
        if (s.tocando) {
          p.loadVideoById({ videoId: f.youtube_id, startSeconds: pos });
          ytPlayAsked.current = Date.now();
        } else p.cueVideoById({ videoId: f.youtube_id, startSeconds: pos });
        return;
      }
      const st = p.getPlayerState();
      const t = p.getCurrentTime?.() ?? 0;
      if (s.tocando) {
        const pastEnd = dur && !loopOne(s) && pos >= dur - 0.4;
        if (!pastEnd && Math.abs(t - pos) > 2.5) p.seekTo(pos, true);
        if (st !== 1 && st !== 3 && !(st === 0 && pastEnd)) {
          if (!ytPlayAsked.current) ytPlayAsked.current = Date.now();
          p.playVideo();
        }
        if (pastEnd && st !== 1) reportEnded();
      } else {
        ytPlayAsked.current = 0;
        if (st === 1 || st === 3) p.pauseVideo();
        if (Math.abs(t - pos) > 1) p.seekTo(pos, true);
      }
      return;
    }

    // plain audio link
    if (yt.current && ytReady.current && ytVideo.current) {
      try {
        yt.current.stopVideo();
      } catch {
        /* player gone */
      }
      ytVideo.current = null;
    }
    let a = audio.current;
    if (!a) {
      a = new Audio();
      a.preload = "auto";
      audio.current = a;
      a.addEventListener("loadedmetadata", () => sync());
      a.addEventListener("playing", () => setBlocked(false));
      a.addEventListener("ended", () => {
        const cur = stateRef.current;
        if (cur && !loopOne(cur)) reportEnded();
      });
      a.addEventListener("error", () => {
        if (audioSrc.current) setError("Não consegui tocar esse link de áudio.");
      });
    }
    if (audioSrc.current !== f.url) {
      audioSrc.current = f.url;
      setError(null);
      a.src = f.url;
    }
    a.loop = loopOne(s);
    a.volume = Math.max(0, Math.min(1, volRef.current));
    const dur = Number.isFinite(a.duration) ? a.duration : null;
    const pos = expected(s, dur);
    if (s.tocando) {
      const pastEnd = dur !== null && !loopOne(s) && pos >= dur - 0.25;
      if (a.readyState >= 1 && !pastEnd && Math.abs(a.currentTime - pos) > 2) a.currentTime = pos;
      if (a.paused && !pastEnd) {
        a.play()
          .then(() => setBlocked(false))
          .catch((e: unknown) => {
            if ((e as { name?: string })?.name === "NotAllowedError") setBlocked(true);
          });
      }
      if (pastEnd && a.paused) reportEnded();
    } else {
      if (!a.paused) a.pause();
      if (a.readyState >= 1 && Math.abs(a.currentTime - pos) > 1) a.currentTime = pos;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportEnded]);

  // create the YouTube player when the first YouTube track shows up
  const needsYT = state?.faixa?.tipo === "youtube";
  useEffect(() => {
    if (!needsYT || yt.current || !host.current) return;
    let cancelled = false;
    loadYouTube()
      .then((YT) => {
        if (cancelled || !host.current || yt.current) return;
        yt.current = new YT.Player(host.current, {
          width,
          height,
          host: "https://www.youtube-nocookie.com",
          playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, fs: 0 },
          events: {
            onReady: (e) => {
              ytReady.current = true;
              e.target.setVolume(Math.round(volRef.current * 100));
              sync();
            },
            onStateChange: (e) => {
              const s = stateRef.current;
              if (e.data === 1) {
                setBlocked(false);
                ytPlayAsked.current = 0;
              }
              if (e.data === 0 && s) {
                if (loopOne(s)) {
                  e.target.seekTo(0, true);
                  e.target.playVideo();
                } else reportEnded();
              }
            },
            onError: (e) => setError(YT_ERRORS[e.data] ?? "O YouTube não deixou tocar esse vídeo."),
            onAutoplayBlocked: () => setBlocked(true),
          },
        });
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar o player do YouTube.");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsYT]);

  useEffect(() => {
    sync();
  }, [state, sync]);

  useEffect(() => {
    if (yt.current && ytReady.current) {
      if (volume <= 0) yt.current.mute();
      else {
        yt.current.unMute();
        yt.current.setVolume(Math.round(volume * 100));
      }
    }
    if (audio.current) audio.current.volume = Math.max(0, Math.min(1, volume));
  }, [volume]);

  // drift correction, autoplay detection and progress
  useEffect(() => {
    const id = setInterval(() => {
      sync();
      const s = stateRef.current;
      let duration: number | null = null;
      let position = 0;
      if (s?.faixa) {
        if (s.faixa.tipo === "youtube") {
          duration = (ytReady.current && yt.current?.getDuration?.()) || null;
          const st = ytReady.current ? yt.current?.getPlayerState() : -1;
          if (s.tocando && ytPlayAsked.current && Date.now() - ytPlayAsked.current > 3000 && (st === -1 || st === 2 || st === 5)) setBlocked(true);
        } else if (audio.current && Number.isFinite(audio.current.duration)) duration = audio.current.duration;
        position = expected(s, duration);
        if (duration && position > duration) position = duration;
      }
      statusRef.current?.({ blocked, error, duration, position });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync, blocked, error]);

  useEffect(
    () => () => {
      try {
        yt.current?.destroy();
      } catch {
        /* already gone */
      }
      yt.current = null;
      ytReady.current = false;
      ytVideo.current = null;
      if (audio.current) {
        audio.current.pause();
        audio.current.removeAttribute("src");
        audio.current.load();
      }
      // forget the element: if this player mounts again it starts clean
      audio.current = null;
      audioSrc.current = null;
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      unlock() {
        const s = stateRef.current;
        if (!s?.faixa || !s.tocando) return;
        if (s.faixa.tipo === "youtube") {
          yt.current?.playVideo();
          setBlocked(false);
        } else {
          audio.current
            ?.play()
            .then(() => setBlocked(false))
            .catch(() => setBlocked(true));
        }
      },
    }),
    [],
  );

  const showVideo = state?.faixa?.tipo === "youtube";
  return (
    <div className="yt-box" style={{ width, height, display: showVideo ? "block" : "none" }} aria-hidden={!showVideo}>
      <div ref={host} />
    </div>
  );
});
