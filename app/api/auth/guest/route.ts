import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { usernameToEmail } from "@/lib/auth-email";
import { DICE_COLORS } from "@/lib/colors";
import { adminClient, clientIp, rateLimited } from "@/lib/supabase/admin";

/** Creates a throwaway account so someone can join a table with just a nickname. */
export async function POST(req: Request) {
  const admin = adminClient();
  if (!admin) return NextResponse.json({ error: "As mesas online ainda não foram configuradas neste site." }, { status: 503 });
  if (rateLimited(`guest:${clientIp(req)}`, 20, 10 * 60_000))
    return NextResponse.json({ error: "Muitos convidados criados daqui. Tente de novo em alguns minutos." }, { status: 429 });

  let body: { nickname?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const nickname = (body.nickname ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (nickname.length < 2) return NextResponse.json({ error: "Escreva um apelido com pelo menos 2 letras." }, { status: 400 });

  const username = `convidado_${randomBytes(5).toString("hex")}`;
  const email = usernameToEmail(username);
  const password = randomBytes(24).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name: nickname, is_guest: true },
  });
  if (error || !data.user) {
    console.error("guest creation failed", error);
    return NextResponse.json({ error: "Não foi possível entrar como convidado agora." }, { status: 500 });
  }
  const color = DICE_COLORS[randomBytes(1)[0] % DICE_COLORS.length].hex;
  const { error: pErr } = await admin
    .from("profiles")
    .upsert({ id: data.user.id, username, display_name: nickname, is_guest: true, dice_color: color }, { onConflict: "id" });
  if (pErr) console.error("guest profile upsert failed (ensure_profile will retry)", pErr);

  return NextResponse.json({ email, password });
}
