import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

const OAUTH_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";

const SECURE_REDIRECT_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
} as const;

function mustEnv(name: string) {
  const v = (process.env[name] || "").trim();
  return v;
}

function safeAppLoginUrl(req: NextRequest) {
  const app = (process.env.NEXT_PUBLIC_APP_URL || "").trim();
  try {
    if (app) return new URL("/login", app).toString();
  } catch {}
  return new URL("/login", req.url).toString();
}

function b64urlEncode(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomState() {
  return b64urlEncode(crypto.randomBytes(24)); // 32 chars-ish
}

export async function GET(req: NextRequest) {
  const client_id = mustEnv("DISCORD_CLIENT_ID");
  const redirect_uri = mustEnv("DISCORD_REDIRECT_URI");

  // se env quebrado, volta pro login (sem estourar)
  if (!client_id || !redirect_uri) {
    const resp = NextResponse.redirect(safeAppLoginUrl(req));
    Object.entries(SECURE_REDIRECT_HEADERS).forEach(([k, v]) =>
      resp.headers.set(k, v),
    );
    return resp;
  }

  // CSRF state
  const state = randomState();

  const params = new URLSearchParams({
    client_id,
    redirect_uri,
    response_type: "code",
    scope: "identify email",
    state,
  });

  const authorizeUrl = `${OAUTH_AUTHORIZE_URL}?${params.toString()}`;

  const resp = NextResponse.redirect(authorizeUrl);

  // cookie httpOnly para validar state no callback
  resp.cookies.set("discord_oauth_state", state, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 10, // 10 min
  });

  Object.entries(SECURE_REDIRECT_HEADERS).forEach(([k, v]) =>
    resp.headers.set(k, v),
  );

  return resp;
}
