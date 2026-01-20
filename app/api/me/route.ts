import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECURE_JSON_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  Vary: "Cookie",
} as const;

const SESSION_SECRET = (
  process.env.DISCORD_SESSION_SECRET ||
  process.env.DISCORD_CLIENT_SECRET ||
  ""
).trim();

function safeJsonParse<T = any>(raw: string): { ok: true; value: T } | { ok: false } {
  try {
    if (!raw) return { ok: false };
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false };
  }
}

function tryParseCookieObject(raw: string): any | null {
  if (!raw) return null;

  // 1) tenta parse direto
  const p1 = safeJsonParse(raw);
  if (p1.ok && p1.value && typeof p1.value === "object") return p1.value;

  // 2) tenta decodeURIComponent e parse
  try {
    const decoded = decodeURIComponent(raw);
    const p2 = safeJsonParse(decoded);
    if (p2.ok && p2.value && typeof p2.value === "object") return p2.value;
  } catch {
    // ignore
  }

  return null;
}

function hmacSign(data: string) {
  if (!SESSION_SECRET) return "";
  return crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
}

function timingSafeEq(a: string, b: string) {
  const ab = Buffer.from(a || "", "utf8");
  const bb = Buffer.from(b || "", "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function isExpired(obj: any) {
  const exp = Number(obj?.__session?.exp_ms);
  if (!Number.isFinite(exp) || exp <= 0) return false; // compat
  return Date.now() > exp;
}

function clearSessionCookies(resp: NextResponse) {
  resp.cookies.set("discord_user", "", { path: "/", maxAge: 0 });
  resp.cookies.set("discord_user_sig", "", { path: "/", maxAge: 0 });
  return resp;
}

export async function GET() {
  // Next 16 pode exigir await (e mesmo se não exigir, não quebra)
  const store = await cookies();

  const rawUser = store.get("discord_user")?.value || "";
  const rawSig = store.get("discord_user_sig")?.value || "";

  if (!rawUser) {
    return NextResponse.json({ user: null }, { status: 200, headers: SECURE_JSON_HEADERS });
  }

  // anti-tamper (se existir secret e sig)
  if (SESSION_SECRET && rawSig) {
    const sig2 = hmacSign(rawUser);
    if (!sig2 || !timingSafeEq(rawSig, sig2)) {
      const resp = NextResponse.json({ user: null }, { status: 200, headers: SECURE_JSON_HEADERS });
      return clearSessionCookies(resp);
    }
  }

  const userObj = tryParseCookieObject(rawUser);
  if (!userObj) {
    const resp = NextResponse.json({ user: null }, { status: 200, headers: SECURE_JSON_HEADERS });
    return clearSessionCookies(resp);
  }

  if (isExpired(userObj)) {
    const resp = NextResponse.json({ user: null }, { status: 200, headers: SECURE_JSON_HEADERS });
    return clearSessionCookies(resp);
  }

  // mantém compat: retorna o user inteiro (inclui email se estiver no cookie)
  return NextResponse.json({ user: userObj }, { status: 200, headers: SECURE_JSON_HEADERS });
}
