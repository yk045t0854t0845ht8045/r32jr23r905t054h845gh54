import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECURE_JSON_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
} as const;

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // Não dá throw aqui pra não quebrar build; devolvemos erro em runtime
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type DiscountKind = "percent" | "amount" | "target_total";

function normalizeCode(v: unknown) {
  return String(v || "").trim().toUpperCase();
}

function nowEpochSec() {
  return Math.floor(Date.now() / 1000);
}

function safeJson<T = any>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: SECURE_JSON_HEADERS });
}

function safeParseDiscordUserCookie(raw: string | undefined | null): any | null {
  try {
    if (!raw) return null;
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractDiscordId(req: NextRequest): string | null {
  // tenta cookie do browser (HttpOnly também aparece aqui no server)
  const cookie = req.cookies.get("discord_user")?.value || "";
  const parsed = safeParseDiscordUserCookie(cookie);

  const id =
    String(parsed?.id || parsed?.discord_id || parsed?.user?.id || "").trim();

  if (id) return id;

  // fallback: querystring (menos seguro, mas útil se cookie não existir)
  const { searchParams } = new URL(req.url);
  const q = String(searchParams.get("discord_id") || "").trim();
  return q || null;
}

async function validateCouponOnly(code: string, discordId: string | null) {
  const now = nowEpochSec();
  const upper = normalizeCode(code);
  if (!upper) {
    return { ok: true, valid: false, message: "Código ausente." as const };
  }

  // 1) gift primeiro
  {
    const { data: gift, error } = await supabaseAdmin
      .from("gift_coupons")
      .select(
        "code,active,discord_id,expires_at_epoch,starts_at_epoch,max_uses,uses_count,discount_kind,discount_percent,discount_amount_cents,target_total_cents",
      )
      .eq("code", upper)
      .limit(1)
      .maybeSingle();

    if (error) {
      return { ok: false, message: "Falha ao consultar cupom." as const };
    }

    if (gift) {
      if (!gift.active) {
        return { ok: true, valid: false, message: "Cupom inativo." as const };
      }

      if (!discordId) {
        return {
          ok: true,
          valid: false,
          message: "Sessão inválida. Faça login novamente.",
        };
      }

      if (String(gift.discord_id || "") !== String(discordId)) {
        return {
          ok: true,
          valid: false,
          message: "Este cupom é inválido ou não disponível." as const,
        };
      }

      if (Number(gift.starts_at_epoch || 0) !== 0 && now < Number(gift.starts_at_epoch)) {
        return { ok: true, valid: false, message: "Cupom ainda não disponível." as const };
      }

      if (Number(gift.expires_at_epoch || 0) !== 0 && now > Number(gift.expires_at_epoch)) {
        return { ok: true, valid: false, message: "Cupom expirado." as const };
      }

      const maxUses = Number(gift.max_uses || 0);
      const uses = Number(gift.uses_count || 0);

      if (maxUses !== 0 && uses >= maxUses) {
        return { ok: true, valid: false, message: "Cupom sem usos disponíveis." as const };
      }

      return {
        ok: true,
        valid: true,
        source: "gift_coupon" as const,
        code: upper,
        discount: {
          kind: String(gift.discount_kind) as DiscountKind,
          percent: gift.discount_percent ?? null,
          amount_cents: gift.discount_amount_cents ?? null,
          target_total_cents: gift.target_total_cents ?? null,
        },
        meta: {
          max_uses: maxUses,
          uses_count: uses,
          expires_at_epoch: Number(gift.expires_at_epoch || 0),
          starts_at_epoch: Number(gift.starts_at_epoch || 0),
          discord_id: String(gift.discord_id || ""),
        },
      };
    }
  }

  // 2) normal
  {
    const { data: c, error } = await supabaseAdmin
      .from("coupons")
      .select(
        "code,active,exclusive_discord_id,expires_at_epoch,starts_at_epoch,max_uses,uses_count,discount_kind,discount_percent,discount_amount_cents,target_total_cents",
      )
      .eq("code", upper)
      .limit(1)
      .maybeSingle();

    if (error) {
      return { ok: false, message: "Falha ao consultar cupom." as const };
    }

    if (!c) {
      return { ok: true, valid: false, message: "Cupom inválido ou indisponível." as const };
    }

    if (!c.active) {
      return { ok: true, valid: false, message: "Cupom inativo." as const };
    }

    if (c.exclusive_discord_id) {
      if (!discordId) {
        return {
          ok: true,
          valid: false,
          message: "Sessão inválida. Faça login novamente.",
        };
      }
      if (String(c.exclusive_discord_id) !== String(discordId)) {
        return {
          ok: true,
          valid: false,
          message: "Este cupom é inválido ou não disponível." as const,
        };
      }
    }

    if (Number(c.starts_at_epoch || 0) !== 0 && now < Number(c.starts_at_epoch)) {
      return { ok: true, valid: false, message: "Cupom ainda não disponível." as const };
    }

    if (Number(c.expires_at_epoch || 0) !== 0 && now > Number(c.expires_at_epoch)) {
      return { ok: true, valid: false, message: "Cupom expirado." as const };
    }

    const maxUses = Number(c.max_uses || 0);
    const uses = Number(c.uses_count || 0);

    if (maxUses !== 0 && uses >= maxUses) {
      return { ok: true, valid: false, message: "Cupom sem usos disponíveis." as const };
    }

    return {
      ok: true,
      valid: true,
      source: "coupon" as const,
      code: upper,
      discount: {
        kind: String(c.discount_kind) as DiscountKind,
        percent: c.discount_percent ?? null,
        amount_cents: c.discount_amount_cents ?? null,
        target_total_cents: c.target_total_cents ?? null,
      },
      meta: {
        max_uses: maxUses,
        uses_count: uses,
        expires_at_epoch: Number(c.expires_at_epoch || 0),
        starts_at_epoch: Number(c.starts_at_epoch || 0),
        exclusive_discord_id: c.exclusive_discord_id ? String(c.exclusive_discord_id) : null,
      },
    };
  }
}

// GET => valida (NÃO consome)
export async function GET(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return safeJson(
      { ok: false, message: "Supabase env ausente (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." },
      500,
    );
  }

  const { searchParams } = new URL(req.url);
  const code = normalizeCode(searchParams.get("code"));
  const discordId = extractDiscordId(req);

  const result = await validateCouponOnly(code, discordId);
  return safeJson(result, result.ok ? 200 : 500);
}

// POST => claim (consome uso ATOMICAMENTE via função SQL claim_coupon)
export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return safeJson(
      { ok: false, message: "Supabase env ausente (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)." },
      500,
    );
  }

  const body = await req.json().catch(() => null);
  const action = String(body?.action || "claim").trim(); // "claim" | "validate"
  const code = normalizeCode(body?.code);
  const discordId =
    extractDiscordId(req) || String(body?.discord_id || "").trim() || null;

  if (!code) return safeJson({ ok: true, valid: false, message: "Código ausente." }, 200);

  if (action === "validate") {
    const result = await validateCouponOnly(code, discordId);
    return safeJson(result, result.ok ? 200 : 500);
  }

  // claim precisa discordId
  if (!discordId) {
    return safeJson(
      { ok: true, valid: false, message: "Sessão inválida. Faça login novamente." },
      200,
    );
  }

  const payment_id = body?.payment_id ? String(body.payment_id) : null;
  const order_id = body?.order_id ? String(body.order_id) : null;

  const { data, error } = await supabaseAdmin.rpc("claim_coupon", {
    p_code: code,
    p_discord_id: discordId,
    p_payment_id: payment_id,
    p_order_id: order_id,
  });

  if (error) {
    return safeJson({ ok: false, message: "Falha ao consumir cupom." }, 500);
  }

  // data já é jsonb do postgres
  return safeJson(data ?? { ok: false, message: "Resposta inválida." }, 200);
}
