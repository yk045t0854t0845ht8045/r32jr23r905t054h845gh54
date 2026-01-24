import { NextRequest, NextResponse } from "next/server";

const APP_ORIGIN = (process.env.APP_ORIGIN || "").trim();
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function normalizeOrigin(input: string) {
  try {
    return new URL(input).origin;
  } catch {
    return null;
  }
}

function getRequestOrigin(req: NextRequest) {
  const protoRaw = (req.headers.get("x-forwarded-proto") || "").trim();
  const hostRaw =
    (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").trim();

  const proto = (protoRaw.split(",")[0] || "").trim() || "https";
  const host = (hostRaw.split(",")[0] || "").trim();

  if (!host) return null;
  if (proto !== "http" && proto !== "https") return `https://${host}`;
  return `${proto}://${host}`;
}

function pickAllowedOrigin(req: NextRequest) {
  const originHdr = (req.headers.get("origin") || "").trim();
  const reqOrigin = getRequestOrigin(req);

  const origin = originHdr ? normalizeOrigin(originHdr) : null;

  // allowlist: APP_ORIGIN, ALLOWED_ORIGINS e o próprio host do request (evita 403 quando APP_ORIGIN está “diferente”)
  const allow = new Set<string>(
    [APP_ORIGIN, reqOrigin, ...ALLOWED_ORIGINS].filter(Boolean) as string[],
  );

  // Se tem Origin e é permitido -> ecoa
  if (origin && allow.has(origin)) return origin;

  // Se tem Origin e bate com o host real -> ecoa (mesmo se APP_ORIGIN estiver errado)
  if (origin && reqOrigin && origin === reqOrigin) return origin;

  // Se não tem Origin (SSR/server-to-server), não seta Allow-Origin (não precisa)
  return null;
}

function buildCorsHeaders(req: NextRequest) {
  const h = new Headers();

  const allowed = pickAllowedOrigin(req);
  if (allowed) {
    h.set("Access-Control-Allow-Origin", allowed);
    h.set("Vary", "Origin");
    h.set("Access-Control-Allow-Credentials", "true");
  }

  h.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  h.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, X-Idempotency-Key",
  );
  h.set("Access-Control-Max-Age", "86400");

  // hardening básico
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "same-origin");

  return h;
}

export function proxy(req: NextRequest) {
  // Só API
  if (!req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const cors = buildCorsHeaders(req);

  // Preflight
  if (req.method === "OPTIONS") {
    const res = new NextResponse(null, { status: 204 });
    cors.forEach((v, k) => res.headers.set(k, v));
    return res;
  }

  const res = NextResponse.next();
  cors.forEach((v, k) => res.headers.set(k, v));
  return res;
}

export const config = {
  matcher: ["/api/:path*"],
};
