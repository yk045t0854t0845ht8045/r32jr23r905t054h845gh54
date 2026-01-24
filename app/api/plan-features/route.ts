import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const SECURE_JSON_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
} as const;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;

export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_env",
        message:
          "Supabase admin client não inicializou. Verifique SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env",
      },
      { status: 500, headers: SECURE_JSON_HEADERS },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("plan_features")
    .select("plan_key, position, feature_text")
    .order("plan_key", { ascending: true })
    .order("position", { ascending: true });

  if (error) {
    return NextResponse.json(
      { ok: false, error: "query_error", details: error },
      { status: 500, headers: SECURE_JSON_HEADERS },
    );
  }

  return NextResponse.json(
    { ok: true, data: data ?? [] },
    { status: 200, headers: SECURE_JSON_HEADERS },
  );
}
