"use client";

import { Icon } from "./glyphs";
import { toast } from "./Toaster";

export function mesaLink(code: string) {
  if (typeof window === "undefined") return `/mesa/${code}`;
  return `${window.location.origin}/mesa/${code}`;
}

export async function shareMesa(code: string, name: string) {
  const url = mesaLink(code);
  try {
    if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
      await navigator.share({ title: name, text: `Entre na mesa "${name}" no Runa (código ${code})`, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast("Link da mesa copiado.");
  } catch {
    toast(`Código da mesa: ${code}`);
  }
}

export function CodeBox({ code, name, compact }: { code: string; name: string; compact?: boolean }) {
  return (
    <span className={`code-box${compact ? " compact" : ""}`} title="Código para entrar na mesa">
      <span className="code" aria-label={`Código ${code.split("").join(" ")}`}>
        {code}
      </span>
      <button type="button" className="btn btn-small" onClick={() => void shareMesa(code, name)}>
        <Icon name="share" size={16} />
        Convidar
      </button>
    </span>
  );
}
