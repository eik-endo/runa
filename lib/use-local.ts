"use client";

import { useCallback, useEffect, useState } from "react";

/** State persisted in localStorage (read after mount so SSR markup stays stable). */
export function useLocalState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* private mode or bad JSON: keep the default */
    }
    setReady(true);
  }, [key]);

  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* storage full or blocked */
        }
        return next;
      });
    },
    [key],
  );

  return [value, set, ready];
}
