import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { upsertDiscordUserFromDiscord } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
const DISCORD_ME_URL = "https://discord.com/api/users/@me";

const SECURE_REDIRECT_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
} as const;

const SESSION_MAX_AGE_SECONDS = Number(
  process.env.DISCORD_SESSION_MAX_AGE_SECONDS || String(60 * 60 * 24),
); // 24h default

const SESSION_SECRET = (
  process.env.DISCORD_SESSION_SECRET ||
  process.env.DISCORD_CLIENT_SECRET ||
  ""
).trim();

function mustEnv(name: string) {
  return (process.env[name] || "").trim();
}

function safeAppLoginUrl(req: NextRequest) {
  const app = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  try {
    if (app) return new URL("/login", app).toString();
  } catch {}
  return new URL("/login", req.url).toString();
}

function safeRedirect(req: NextRequest) {
  const resp = NextResponse.redirect(safeAppLoginUrl(req));
  Object.entries(SECURE_REDIRECT_HEADERS).forEach(([k, v]) =>
    resp.headers.set(k, v),
  );
  return resp;
}

function normalizeOAuthCode(v: string | null) {
  const raw = (v || "").trim();
  if (!raw) return "";
  if (raw.length > 4000) return "";
  // discord code geralmente é url-safe/base64-like; aceitamos chars comuns
  if (!/^[A-Za-z0-9._-]+$/.test(raw)) return "";
  return raw;
}

function normalizeState(v: string | null) {
  const raw = (v || "").trim();
  if (!raw) return "";
  if (raw.length > 256) return "";
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return "";
  return raw;
}

function timingSafeEq(a: string, b: string) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function hmacSign(data: string) {
  if (!SESSION_SECRET) return "";
  return crypto.createHmac("sha256", SESSION_SECRET).update(data).digest("hex");
}

function buildSessionCookie(discordId: string) {
  const issued_at = Date.now();
  const exp_ms =
    issued_at +
    Math.max(
      60,
      Number.isFinite(SESSION_MAX_AGE_SECONDS) ? SESSION_MAX_AGE_SECONDS : 86400,
    ) *
      1000;

  return {
    discord_id: String(discordId || "").trim(),
    __session: {
      v: 2,
      issued_at,
      exp_ms,
    },
  };
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 12000,
) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(2000, timeoutMs));
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      cache: "no-store",
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { res, data };
  } finally {
    clearTimeout(t);
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const code = normalizeOAuthCode(searchParams.get("code"));
  const returnedState = normalizeState(searchParams.get("state"));
  const oauthError = (searchParams.get("error") || "").trim();

  // se o discord retornou erro, volta pro login
  if (oauthError) {
    const r = safeRedirect(req);
    // limpa state pra evitar reuse
    r.cookies.set("discord_oauth_state", "", { path: "/", maxAge: 0 });
    return r;
  }

  if (!code) {
    const r = safeRedirect(req);
    r.cookies.set("discord_oauth_state", "", { path: "/", maxAge: 0 });
    return r;
  }

  const client_id = mustEnv("DISCORD_CLIENT_ID");
  const client_secret = mustEnv("DISCORD_CLIENT_SECRET");
  const redirect_uri = mustEnv("DISCORD_REDIRECT_URI");

  if (!client_id || !client_secret || !redirect_uri) {
    const r = safeRedirect(req);
    r.cookies.set("discord_oauth_state", "", { path: "/", maxAge: 0 });
    return r;
  }

  // valida state (CSRF)
  const storedState = (req.cookies.get("discord_oauth_state")?.value || "").trim();
  if (!storedState || !returnedState || !timingSafeEq(storedState, returnedState)) {
    const r = safeRedirect(req);
    r.cookies.set("discord_oauth_state", "", { path: "/", maxAge: 0 });
    return r;
  }

  // state é one-time
  let response = safeRedirect(req);
  response.cookies.set("discord_oauth_state", "", { path: "/", maxAge: 0 });

  // troca code por access token
  const tokenBody = new URLSearchParams({
    client_id,
    client_secret,
    grant_type: "authorization_code",
    code,
    redirect_uri,
  });

  const { res: tokenRes, data: token } = await fetchJsonWithTimeout(
    DISCORD_TOKEN_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    },
    12000,
  );

  if (!tokenRes.ok || !token?.access_token || typeof token.access_token !== "string") {
    // não grava cookies se falhou
    response.cookies.set("discord_user", "", { path: "/", maxAge: 0 });
    response.cookies.set("discord_user_sig", "", { path: "/", maxAge: 0 });
    return response;
  }

  const accessToken = token.access_token as string;
  const tokenType =
    typeof token.token_type === "string" ? token.token_type : "Bearer";
  const authHeader = `${tokenType} ${accessToken}`;

  // busca user @me
  const { res: userRes, data: user } = await fetchJsonWithTimeout(
    DISCORD_ME_URL,
    {
      headers: { Authorization: authHeader },
    },
    12000,
  );

  if (!userRes.ok || !user || typeof user !== "object") {
    response.cookies.set("discord_user", "", { path: "/", maxAge: 0 });
    response.cookies.set("discord_user_sig", "", { path: "/", maxAge: 0 });
    return response;
  }

  // ✅ salva/atualiza no Supabase (banco)
  const up = await upsertDiscordUserFromDiscord(user);

  // ✅ cookie agora vira “sessão mínima” (não carrega user inteiro)
  const sessionPayload = buildSessionCookie(String(user?.id || ""));

  // se supabase falhar, ainda deixa um fallback mínimo (não muda sua UI)
  // (você pode remover esse bloco depois se quiser “somente Supabase”)
  if (!up.ok) {
    (sessionPayload as any).__session.supabase_ok = false;
  } else {
    (sessionPayload as any).__session.supabase_ok = true;
  }

  const sessionJson = JSON.stringify(sessionPayload).replace(
    /[\u0000-\u001F\u007F]/g,
    "",
  );

  const sig = hmacSign(sessionJson);

  response.cookies.set("discord_user", sessionJson, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.max(
      60,
      Number.isFinite(SESSION_MAX_AGE_SECONDS) ? SESSION_MAX_AGE_SECONDS : 86400,
    ),
  });

  if (sig) {
    response.cookies.set("discord_user_sig", sig, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: Math.max(
        60,
        Number.isFinite(SESSION_MAX_AGE_SECONDS) ? SESSION_MAX_AGE_SECONDS : 86400,
      ),
    });
  } else {
    response.cookies.set("discord_user_sig", "", { path: "/", maxAge: 0 });
  }

  Object.entries(SECURE_REDIRECT_HEADERS).forEach(([k, v]) =>
    response.headers.set(k, v),
  );

  return response;
}
