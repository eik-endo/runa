import { NextResponse } from "next/server";

/** Looks up a YouTube video's title (the browser cannot call YouTube's oEmbed directly). */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("v") ?? "";
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return NextResponse.json({ error: "Vídeo inválido." }, { status: 400 });
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return NextResponse.json({ error: res.status === 401 || res.status === 403 ? "embed-blocked" : "not-found" }, { status: 404 });
    const data = (await res.json()) as { title?: string; author_name?: string };
    return NextResponse.json({ title: (data.title ?? "").slice(0, 120), author: data.author_name ?? "" }, { headers: { "cache-control": "public, max-age=86400" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
}
