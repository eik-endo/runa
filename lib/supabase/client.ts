"use client";

import { type SupabaseClient, createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** Online tables need Supabase; without it the solo roller still works. */
export const onlineEnabled = Boolean(URL && KEY);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!onlineEnabled) throw new Error("O Supabase não está configurado neste site.");
  if (!client) {
    client = createClient(URL!, KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "runa-auth", detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
  }
  return client;
}
