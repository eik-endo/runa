/**
 * Accounts use a user name, not an e-mail. Supabase Auth needs an e-mail-shaped
 * login, so each user name maps to an address on a reserved domain that never
 * receives mail (accounts are created already confirmed, nothing is sent).
 */
export const AUTH_EMAIL_DOMAIN = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN || "jogadores.runa.invalid";

export const USERNAME_RE = /^[a-z0-9][a-z0-9_.-]{2,23}$/;

export function normalizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_");
}

export function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
}
