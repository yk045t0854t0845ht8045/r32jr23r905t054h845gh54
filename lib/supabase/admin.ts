import "server-only";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

function mustEnv(name: string) {
  const v = (process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const supabaseAdmin = createClient(
  SUPABASE_URL || mustEnv("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY || mustEnv("SUPABASE_SERVICE_ROLE_KEY"),
  {
    auth: { persistSession: false },
    global: {
      headers: { "X-Client-Info": "atlasbot-discord-login" },
    },
  },
);

export type DbDiscordUserRow = {
  discord_id: string;
  username: string | null;
  discriminator: string | null;
  avatar: string | null;
  email: string | null;
  raw: any;
  created_at: string;
  updated_at: string;
  last_login_at: string;
};

export async function upsertDiscordUserFromDiscord(user: any): Promise<{
  ok: boolean;
  error: string | null;
}> {
  try {
    const discord_id = String(user?.id || "").trim();
    if (!discord_id) return { ok: false, error: "Missing user.id" };

    const row = {
      discord_id,
      username: typeof user?.username === "string" ? user.username : null,
      discriminator: typeof user?.discriminator === "string" ? user.discriminator : null,
      avatar: typeof user?.avatar === "string" ? user.avatar : null,
      email: typeof user?.email === "string" ? user.email : null,
      raw: user ?? null,
      last_login_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from("discord_users")
      .upsert(row, { onConflict: "discord_id" });

    if (error) return { ok: false, error: error.message };
    return { ok: true, error: null };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e || "Unknown error") };
  }
}

export async function getDiscordUserById(discordId: string): Promise<{
  ok: boolean;
  user: DbDiscordUserRow | null;
  error: string | null;
}> {
  try {
    const id = String(discordId || "").trim();
    if (!id) return { ok: true, user: null, error: null };

    const { data, error } = await supabaseAdmin
      .from("discord_users")
      .select("*")
      .eq("discord_id", id)
      .maybeSingle();

    if (error) return { ok: false, user: null, error: error.message };
    return { ok: true, user: (data as any) ?? null, error: null };
  } catch (e: any) {
    return { ok: false, user: null, error: String(e?.message || e || "Unknown error") };
  }
}
