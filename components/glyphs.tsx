import { RUNE_BY_KEY, type Rune, runePath } from "@/lib/dice/runes";
import type { DieSpec } from "@/lib/dice/types";

export function RuneGlyph({ rune, size = 22, weight = 9 }: { rune: Rune | string; size?: number; weight?: number }) {
  const r = typeof rune === "string" ? RUNE_BY_KEY[rune] : rune;
  if (!r) return null;
  return (
    <svg className="rune-glyph" width={size * 0.78} height={size} viewBox="-8 -8 116 116" aria-hidden="true">
      <path d={runePath(r)} strokeWidth={weight} />
    </svg>
  );
}

export function Logo() {
  return (
    <svg viewBox="0 0 22 26" aria-hidden="true">
      <path
        d="M6.5 23.5V2.5L15.6 8 6.5 13.5l9.5 10"
        fill="none"
        stroke="#e9a944"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const SHAPES: Record<string, React.ReactNode> = {
  coin: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5.2" />
    </>
  ),
  d4: <path d="M12 3.2 20.6 19H3.4Z" />,
  d6: <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="2.6" />,
  d8: <path d="M12 2.6 20.4 12 12 21.4 3.6 12ZM3.6 12h16.8" />,
  d10: <path d="M12 2.6 20 10.6 12 21.4 4 10.6ZM4 10.6l8 3 8-3M12 13.6v7.8" />,
  d12: <path d="M12 2.8 21 9.4l-3.4 10.5H6.4L3 9.4Z" />,
  d20: <path d="M12 2.4 20.5 7.2v9.6L12 21.6l-8.5-4.8V7.2ZM12 7.2l4.8 8.3H7.2Z" />,
  d100: <path d="M8.5 3.2 14 8.8 8.5 16.6 3 8.8Zm7 4.2 5.5 5.6-5.5 7.8-3.2-4.5" />,
  custom: <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9ZM9.6 9.6a2.6 2.6 0 1 1 3.5 2.4c-.8.3-1.1.9-1.1 1.6v.6M12 16.8v.2" />,
};

export function DieIcon({ die, size = 30 }: { die: DieSpec | "custom"; size?: number }) {
  let key = "custom";
  if (die !== "custom") {
    if (die.type === "pct") key = "d100";
    else if (die.type === "rune") return <RuneGlyph rune="raidho" size={size} weight={11} />;
    else if (die.type === "std" && !die.name) key = die.sides === 2 ? "coin" : `d${die.sides}`;
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      {SHAPES[key] ?? SHAPES.custom}
    </svg>
  );
}

export type IconName =
  | "sound"
  | "mute"
  | "trash"
  | "x"
  | "copy"
  | "repeat"
  | "plus"
  | "gear"
  | "lock"
  | "share"
  | "play"
  | "pause"
  | "next"
  | "prev"
  | "stop"
  | "music"
  | "shuffle"
  | "grip"
  | "up"
  | "down"
  | "search"
  | "eye"
  | "eyeOff"
  | "edit";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    sound: <path d="M4 9v6h4l5 4V5L8 9H4Zm12.5-.5a5 5 0 0 1 0 7M18.9 6a8.5 8.5 0 0 1 0 12" />,
    mute: <path d="M4 9v6h4l5 4V5L8 9H4Zm12 .5 5 5m0-5-5 5" />,
    trash: <path d="M4 7h16M9 7V4.8h6V7m-8.5 0 1 13h9l1-13M10 11v6m4-6v6" />,
    x: <path d="M6 6l12 12M18 6 6 18" />,
    copy: <path d="M8 8h11v12H8zM5 16V4h11" />,
    repeat: <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7M20 4v4.7h-4.7M20 12a8 8 0 0 1-13.7 5.6L4 15.3M4 20v-4.7h4.7" />,
    plus: <path d="M12 5v14M5 12h14" />,
    gear: (
      <>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.8v2.6m0 13.2v2.6M2.8 12h2.6m13.2 0h2.6M5.5 5.5l1.8 1.8m9.4 9.4 1.8 1.8m0-13-1.8 1.8m-9.4 9.4-1.8 1.8" />
      </>
    ),
    lock: <path d="M6 11h12v9H6zm2.5 0V8a3.5 3.5 0 0 1 7 0v3" />,
    share: <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v7h14v-7" />,
    play: <path d="M8 5.5v13l10.5-6.5Z" fill="currentColor" />,
    pause: <path d="M8 5.5v13M16 5.5v13" strokeWidth="3" />,
    next: <path d="M6 6l9 6-9 6Zm12 0v12" fill="currentColor" />,
    prev: <path d="M18 6l-9 6 9 6ZM6 6v12" fill="currentColor" />,
    stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" />,
    music: <path d="M9 18V5.5l11-2V16M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />,
    shuffle: <path d="M3 7h3.5c4 0 6 10 10 10H21m0 0-3-3m3 3-3 3M3 17h3.5c1.6 0 2.8-1.5 3.8-3.4M21 7h-4.5c-1.6 0-2.8 1.5-3.8 3.4M21 7l-3-3m3 3-3 3" />,
    grip: <path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" strokeWidth="3" />,
    up: <path d="M6 15l6-6 6 6" />,
    down: <path d="M6 9l6 6 6-6" />,
    search: <path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm5.3-2.2L21 21" />,
    eye: (
      <>
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    eyeOff: <path d="M3 3l18 18M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 4M6.4 6.5C3.9 8.1 2.5 12 2.5 12s3.5 6.5 9.5 6.5a9.3 9.3 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
    edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16Zm9.5-13.5 4 4" />,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
