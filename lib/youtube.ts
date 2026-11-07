"use client";

/** The parts of the YouTube IFrame Player API this app uses. */
export interface YTPlayer {
  loadVideoById(opts: { videoId: string; startSeconds?: number }): void;
  cueVideoById(opts: { videoId: string; startSeconds?: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getVideoData?(): { title?: string; video_id?: string };
  destroy(): void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      width?: string | number;
      height?: string | number;
      videoId?: string;
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YTPlayer }) => void;
        onStateChange?: (e: { data: number; target: YTPlayer }) => void;
        onError?: (e: { data: number }) => void;
        onAutoplayBlocked?: () => void;
      };
    },
  ) => YTPlayer;
  PlayerState: { UNSTARTED: -1; ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YTNamespace> | null = null;

export function loadYouTube(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error("Não foi possível carregar o player do YouTube."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export const YT_ERRORS: Record<number, string> = {
  2: "Link do YouTube inválido.",
  5: "Esse vídeo não toca no navegador.",
  100: "Vídeo não encontrado ou privado.",
  101: "O dono do vídeo não permite tocar fora do YouTube.",
  150: "O dono do vídeo não permite tocar fora do YouTube.",
};
