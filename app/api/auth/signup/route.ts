import { NextResponse } from "next/server";
import { USERNAME_RE, normalizeUsername, usernameToEmail } from "@/lib/auth-email";
import { DEFAULT_DICE_COLOR } from "@/lib/colors";
import { adminClient, clientIp, rateLimited } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "As contas ainda não foram configuradas neste site." }, { status: 503 });
  if (rateLimited(`signup:${clientIp(req)}`, 12, 10 * 60_000))
    return NextResponse.json({ error: "Muitas contas criadas daqui. Tente de novo em alguns minutos." }, { status: 429 });

  let body: { username?: string; password?: string; displayName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const username = normalizeUsername(body.username ?? "");
  const password = body.password ?? "";
  const displayName = (body.displayName ?? "").trim().slice(0, 40) || username;

  if (!USERNAME_RE.test(username))
    return NextResponse.json({ error: "O usuário precisa ter de 3 a 24 letras, números, ponto, hífen ou _." }, { status: 400 });
  if (username.startsWith("convidado_")) return NextResponse.json({ error: "Escolha outro nome de usuário." }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: "A senha precisa ter pelo menos 6 caracteres." }, { status: 400 });
  if (password.length > 72) return NextResponse.json({ error: "A senha pode ter no máximo 72 caracteres." }, { status: 400 });

  const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) return NextResponse.json({ error: "Esse nome de usuário já está em uso." }, { status: 409 });

  const { data, error } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username, display_name: displayName },
  });
  if (error || !data.user) {
    const msg = error?.message ?? "";
    if (/already|exists|registered/i.test(msg)) return NextResponse.json({ error: "Esse nome de usuário já está em uso." }, { status: 409 });
    if (/password/i.test(msg)) return NextResponse.json({ error: "Essa senha não foi aceita. Tente uma mais longa." }, { status: 400 });
    console.error("signup failed", error);
    return NextResponse.json({ error: "Não foi possível criar a conta agora." }, { status: 500 });
  }

  const { error: pErr } = await admin
    .from("profiles")
    .upsert({ id: data.user.id, username, display_name: displayName, is_guest: false, dice_color: DEFAULT_DICE_COLOR }, { onConflict: "id" });
  if (pErr) console.error("profile upsert failed (ensure_profile will retry)", pErr);

  return NextResponse.json({ ok: true, username });
}
