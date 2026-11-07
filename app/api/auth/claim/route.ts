import { NextResponse } from "next/server";
import { USERNAME_RE, normalizeUsername, usernameToEmail } from "@/lib/auth-email";
import { adminClient, clientIp, rateLimited } from "@/lib/supabase/admin";

/** Turns a guest into a regular account, keeping its tables and characters. */
export async function POST(req: Request) {
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "As contas ainda não foram configuradas neste site." }, { status: 503 });
  if (rateLimited(`claim:${clientIp(req)}`, 12, 10 * 60_000))
    return NextResponse.json({ error: "Muitas tentativas. Tente de novo em alguns minutos." }, { status: 429 });

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Entre de novo para continuar." }, { status: 401 });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who.user) return NextResponse.json({ error: "Sua sessão expirou. Entre de novo." }, { status: 401 });

  const { data: prof } = await admin.from("profiles").select("is_guest").eq("id", who.user.id).maybeSingle();
  if (!prof?.is_guest) return NextResponse.json({ error: "Esta conta já tem usuário e senha." }, { status: 400 });

  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const username = normalizeUsername(body.username ?? "");
  const password = body.password ?? "";
  if (!USERNAME_RE.test(username) || username.startsWith("convidado_"))
    return NextResponse.json({ error: "O usuário precisa ter de 3 a 24 letras, números, ponto, hífen ou _." }, { status: 400 });
  if (password.length < 6 || password.length > 72) return NextResponse.json({ error: "A senha precisa ter de 6 a 72 caracteres." }, { status: 400 });

  const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) return NextResponse.json({ error: "Esse nome de usuário já está em uso." }, { status: 409 });

  const { error } = await admin.auth.admin.updateUserById(who.user.id, {
    email: usernameToEmail(username),
    email_confirm: true,
    password,
    user_metadata: { ...who.user.user_metadata, username, is_guest: false },
  });
  if (error) {
    if (/already|exists|registered/i.test(error.message)) return NextResponse.json({ error: "Esse nome de usuário já está em uso." }, { status: 409 });
    console.error("claim failed", error);
    return NextResponse.json({ error: "Não foi possível salvar a conta agora." }, { status: 500 });
  }
  const { error: pErr } = await admin.from("profiles").update({ username, is_guest: false }).eq("id", who.user.id);
  if (pErr) {
    console.error("claim profile update failed", pErr);
    return NextResponse.json({ error: "Não foi possível salvar a conta agora." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, username });
}
