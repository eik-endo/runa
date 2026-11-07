"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { type Profile, ensureProfile, errorMessage } from "@/lib/api";
import { normalizeUsername, usernameToEmail } from "@/lib/auth-email";
import { onlineEnabled, supabase } from "@/lib/supabase/client";

interface AuthValue {
  /** False until the stored session has been checked. */
  ready: boolean;
  online: boolean;
  session: Session | null;
  profile: Profile | null;
  signIn(username: string, password: string): Promise<void>;
  signUp(username: string, password: string, displayName: string): Promise<void>;
  enterAsGuest(nickname: string): Promise<void>;
  claimGuest(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  refreshProfile(): Promise<void>;
  setProfile(p: Profile): void;
}

const Ctx = createContext<AuthValue | null>(null);

async function postJSON(url: string, body: unknown, token?: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Não foi possível falar com o servidor.");
  return data;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!onlineEnabled);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      setProfile(await ensureProfile());
    } catch (e) {
      console.warn("perfil indisponível:", errorMessage(e));
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    if (!onlineEnabled) return;
    const sb = supabase();
    let alive = true;
    sb.auth
      .getSession()
      .then(async ({ data }) => {
        if (!alive) return;
        setSession(data.session);
        if (data.session) await loadProfile();
      })
      .finally(() => alive && setReady(true));
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_OUT") setProfile(null);
      // never call Supabase inside this callback directly (it holds the auth lock)
      if (event === "SIGNED_IN" || event === "USER_UPDATED") setTimeout(() => void loadProfile(), 0);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const { error } = await supabase().auth.signInWithPassword({ email: usernameToEmail(username), password });
      if (error) {
        if (/invalid login credentials/i.test(error.message)) throw new Error("Usuário ou senha incorretos.");
        throw new Error(errorMessage(error));
      }
      await loadProfile();
    },
    [loadProfile],
  );

  const signUp = useCallback(
    async (username: string, password: string, displayName: string) => {
      const { username: u } = await postJSON("/api/auth/signup", { username, password, displayName });
      await signIn(u ?? normalizeUsername(username), password);
    },
    [signIn],
  );

  const enterAsGuest = useCallback(
    async (nickname: string) => {
      const { email, password } = await postJSON("/api/auth/guest", { nickname });
      const { error } = await supabase().auth.signInWithPassword({ email, password });
      if (error) throw new Error(errorMessage(error));
      await loadProfile();
    },
    [loadProfile],
  );

  const claimGuest = useCallback(
    async (username: string, password: string) => {
      const token = (await supabase().auth.getSession()).data.session?.access_token;
      const { username: u } = await postJSON("/api/auth/claim", { username, password }, token);
      await supabase().auth.signOut();
      await signIn(u ?? username, password);
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    await supabase().auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      online: onlineEnabled,
      session,
      profile,
      signIn,
      signUp,
      enterAsGuest,
      claimGuest,
      signOut,
      refreshProfile: loadProfile,
      setProfile,
    }),
    [ready, session, profile, signIn, signUp, enterAsGuest, claimGuest, signOut, loadProfile],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth fora do AuthProvider");
  return v;
}
