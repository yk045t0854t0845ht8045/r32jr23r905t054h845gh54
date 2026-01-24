import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECURE_JSON_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Type": "application/json; charset=utf-8",
} as const;

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

function json(data: any, status = 200) {
  return NextResponse.json(data, { status, headers: SECURE_JSON_HEADERS });
}

function safeText(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    if (!s || s === "{}" || s === "[]" || s === "null") return fallback;
    return s;
  } catch {
    return fallback;
  }
}

function safeParseDiscordUserCookie(raw: string | undefined | null): any | null {
  try {
    if (!raw) return null;

    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }

    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractDiscordId(req: NextRequest): string | null {
  const cookie = req.cookies.get("discord_user")?.value || "";
  const parsed = safeParseDiscordUserCookie(cookie);

  const id =
    String(
      parsed?.id ||
        parsed?.discord_id ||
        parsed?.user?.id ||
        parsed?.userId ||
        "",
    ).trim();

  if (id) return id;

  // fallback opcional (igual seu cupom)
  const { searchParams } = new URL(req.url);
  const q = String(searchParams.get("discord_id") || "").trim();
  return q || null;
}

async function isDevAllowed(discordId: string) {
  if (!discordId) return false;
  if (!supabaseAdmin) return false;

  try {
    const { data, error } = await supabaseAdmin
      .from("dev_permission")
      .select("dev")
      .eq("discord_id", discordId)
      .limit(1)
      .maybeSingle();

    if (error) return false;
    return !!data?.dev;
  } catch {
    return false;
  }
}

type DevAction = "approve" | "reject" | "expire";
type DevStatus = "approved" | "rejected" | "expired";
type DevKind = "pix" | "boleto" | "card";

function actionToStatus(a: DevAction): DevStatus {
  if (a === "approve") return "approved";
  if (a === "reject") return "rejected";
  return "expired";
}

export async function GET(req: NextRequest) {
  if (!supabaseAdmin) {
    return json(
      {
        ok: false,
        message:
          "Supabase env ausente (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
      },
      500,
    );
  }

  const discordId = extractDiscordId(req);
  if (!discordId) {
    return json(
      { ok: false, message: "Não autenticado (discord_user ausente/ inválido)." },
      401,
    );
  }

  const allowed = await isDevAllowed(discordId);
  return json({ ok: true, allowed });
}

export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return json(
      {
        ok: false,
        message:
          "Supabase env ausente (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).",
      },
      500,
    );
  }

  const discordId = extractDiscordId(req);
  if (!discordId) {
    return json(
      { ok: false, message: "Não autenticado (discord_user ausente/ inválido)." },
      401,
    );
  }

  const allowed = await isDevAllowed(discordId);
  if (!allowed) {
    return json({ ok: false, message: "Sem permissão DEV." }, 403);
  }

  const body = await req.json().catch(() => null);

  const action = String(body?.action || "").trim() as DevAction;
  const kind = String(body?.kind || "").trim() as DevKind;

  if (action !== "approve" && action !== "reject" && action !== "expire") {
    return json({ ok: false, message: "action inválida." }, 400);
  }

  // kind é opcional agora
  const safeKind =
    kind === "pix" || kind === "boleto" || kind === "card" ? kind : null;

  const status = actionToStatus(action);
  const status_detail =
    safeText(body?.status_detail, "") ||
    `DEV simulated: ${status} (by ${discordId})`;

  return json({
    ok: true,
    status,
    status_detail,
    kind: safeKind,
  });
}
