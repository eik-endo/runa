"use client";

import { useEffect, useState } from "react";

const EVENT = "runa:toast";

/** Shows a short message at the bottom of the screen. */
export function toast(message: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}

export function Toaster() {
  const [items, setItems] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const id = ++n;
      setItems((list) => [...list.slice(-2), { id, text: (e as CustomEvent<string>).detail }]);
      setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 3200);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);
  if (!items.length) return null;
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}
