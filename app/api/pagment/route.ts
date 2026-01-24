import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoConfig, Payment } from "mercadopago";
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const runtime = "nodejs";

type Plan = "starter" | "pro" | "premium";
type Billing = "monthly" | "annual";
type Method = "card" | "pix" | "boleto";

const PLAN_PRICES: Record<Billing, Record<Plan, number>> = {
  monthly: { starter: 14.9, pro: 19.9, premium: 22.99 },
  annual: { starter: 12.49, pro: 16.59, premium: 20.79 }, // <- "por mês" (psicológico no card)
};

/** =========================
 * CUPOM (BACKEND) - regras
 * ========================= */
const TEST_COUPON_CODE = "DEVS";
const TEST_COUPON_TARGET_TOTAL = 0.01;
const TEST_COUPON_ENABLED = process.env.NODE_ENV !== "production";

type CouponType = "percent" | "fixed" | "target_total";
type CouponDef = {
  code: string;
  active?: boolean; // default true
  type: CouponType;
  value: number; // percent => 20; fixed/target_total => BRL (ex: 10.00)
  starts_at?: string; // ISO
  ends_at?: string; // ISO
  min_total?: number; // BRL (antes do desconto)
  plans?: Plan[];
  billings?: Billing[];
};

const APP_ORIGIN = (process.env.APP_ORIGIN || "").trim(); // ex: "https://seusite.com"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

//  expirations (opcional)
const MP_PIX_EXPIRATION_MINUTES = Number(
  process.env.MP_PIX_EXPIRATION_MINUTES || "60",
); // 60 min default
const MP_BOLETO_EXPIRATION_DAYS = Number(
  process.env.MP_BOLETO_EXPIRATION_DAYS || "3",
); // 3 dias default

// =========================
// NEW: mínimo por método (evita PolicyAgent em valores muito baixos)
// - Se você quiser permitir 0.01 em DEV, set MP_MIN_PIX_AMOUNT=0.01 no .env.local
// =========================
const MP_MIN_PIX_AMOUNT = Number(process.env.MP_MIN_PIX_AMOUNT || "1.00"); // default 1.00
const MP_MIN_BOLETO_AMOUNT = Number(process.env.MP_MIN_BOLETO_AMOUNT || "1.00"); // default 1.00

//  token para baixar comprovante (mais segurança)
const RECEIPT_SECRET = (
  process.env.RECEIPT_SECRET ||
  process.env.MP_ACCESS_TOKEN ||
  ""
).trim();
const RECEIPT_TOKEN_DAYS = Number(process.env.RECEIPT_TOKEN_DAYS || "14"); // 14 dias

//  segurança adicional (opcional)
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || "50000"); // 50kb
const RATE_LIMIT_WINDOW_SECONDS = Number(
  process.env.RATE_LIMIT_WINDOW_SECONDS || "60",
);
const RATE_LIMIT_MAX_POST = Number(process.env.RATE_LIMIT_MAX_POST || "30"); // 30/min por IP
const RATE_LIMIT_MAX_GET = Number(process.env.RATE_LIMIT_MAX_GET || "120"); // 120/min por IP

//  robustez/estabilidade (opcional)
const MP_TIMEOUT_MS = Number(process.env.MP_TIMEOUT_MS || "20000"); // 20s
const MP_FETCH_RETRIES = Number(process.env.MP_FETCH_RETRIES || "2"); // 2 retries p/ 5xx/429
const MP_FETCH_RETRY_BASE_MS = Number(process.env.MP_FETCH_RETRY_BASE_MS || "250"); // base backoff
const MP_SEARCH_MAX_RESULTS = Number(process.env.MP_SEARCH_MAX_RESULTS || "20"); // buscar pagamentos existentes (dedupe)

//  proteção extra: evita duplicar pagamento por spam/cliques repetidos
const INTENT_DEDUPE_TTL_SECONDS = Number(
  process.env.INTENT_DEDUPE_TTL_SECONDS || "120",
); // 2 minutos

const SECURE_JSON_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
} as const;

const rateStore = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: NextRequest) {
  const xff = (req.headers.get("x-forwarded-for") || "")
    .split(",")[0]
    ?.trim();
  const xrip = (req.headers.get("x-real-ip") || "").trim();
  return xff || xrip || "unknown";
}

function rateLimit(req: NextRequest, kind: "GET" | "POST") {
  const ip = getClientIp(req);
  const key = `${kind}:${ip}`;
  const now = Date.now();
  const windowMs = Math.max(5, RATE_LIMIT_WINDOW_SECONDS) * 1000;
  const max =
    kind === "POST"
      ? Math.max(5, RATE_LIMIT_MAX_POST)
      : Math.max(10, RATE_LIMIT_MAX_GET);

  const cur = rateStore.get(key);
  if (!cur || now > cur.resetAt) {
    rateStore.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, ip, remaining: max - 1, resetAt: now + windowMs };
  }

  if (cur.count >= max) {
    return {
      ok: false,
      ip,
      retryAfterSec: Math.ceil((cur.resetAt - now) / 1000),
      resetAt: cur.resetAt,
    };
  }

  cur.count += 1;
  rateStore.set(key, cur);
  return {
    ok: true,
    ip,
    remaining: Math.max(0, max - cur.count),
    resetAt: cur.resetAt,
  };
}

function enforceBodySize(req: NextRequest) {
  const cl = Number(req.headers.get("content-length") || "");
  if (Number.isFinite(cl) && cl > MAX_BODY_BYTES) return false;
  return true;
}

type MpBoletoAddress = {
  zip_code: string;
  street_name: string;
  street_number: string;
  neighborhood: string;
  city: string;
  federal_unit: string; // UF (ex: "SP")
};

const BR_STATES_TO_UF: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceara: "CE",
  "distrito federal": "DF",
  "espirito santo": "ES",
  goias: "GO",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  para: "PA",
  paraiba: "PB",
  parana: "PR",
  pernambuco: "PE",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

const BR_UF_SET = new Set(Object.values(BR_STATES_TO_UF));

function normalizeDiacriticsLower(s: string) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeFederalUnit(v: any) {
  const raw = normalizeText(v, 60);
  if (!raw) return "";
  const up = raw.toUpperCase().trim();
  if (/^[A-Z]{2}$/.test(up) && BR_UF_SET.has(up)) return up;

  const key = normalizeDiacriticsLower(raw);
  return BR_STATES_TO_UF[key] || "";
}

function normalizeMpBoletoAddress(
  raw: any,
):
  | { ok: true; address: MpBoletoAddress }
  | { ok: false; missing: string[] } {
  const zip_code = onlyDigits(String(raw?.zip_code || raw?.zip || "")).slice(
    0,
    8,
  );
  const street_name = normalizeText(raw?.street_name, 90);
  const street_number = normalizeText(String(raw?.street_number || ""), 20);
  const neighborhood = normalizeText(raw?.neighborhood, 70);
  const city = normalizeText(raw?.city, 70);
  const federal_unit = normalizeFederalUnit(raw?.federal_unit);

  const missing: string[] = [];
  if (zip_code.length !== 8) missing.push("payer.address.zip_code");
  if (!street_name) missing.push("payer.address.street_name");
  if (!street_number) missing.push("payer.address.street_number");
  if (!neighborhood) missing.push("payer.address.neighborhood");
  if (!city) missing.push("payer.address.city");
  if (!federal_unit) missing.push("payer.address.federal_unit");

  if (missing.length) return { ok: false, missing };

  return {
    ok: true,
    address: {
      zip_code,
      street_name,
      street_number,
      neighborhood,
      city,
      federal_unit,
    },
  };
}

function toCents(v: number) {
  return Math.max(0, Math.round((Number(v) + Number.EPSILON) * 100));
}
function centsToNumber(cents?: number | null) {
  const safe = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return Number((safe / 100).toFixed(2));
}

function normalizeCouponCode(v: any) {
  const raw = typeof v === "string" ? v : "";
  const code = raw.trim().toUpperCase();
  return code.replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
}

function parseIsoToMs(iso?: string) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function loadCoupons(): CouponDef[] {
  const defs: CouponDef[] = [];

  if (TEST_COUPON_ENABLED) {
    defs.push({
      code: TEST_COUPON_CODE,
      active: true,
      type: "target_total",
      value: TEST_COUPON_TARGET_TOTAL,
    });
  }

  const raw = (process.env.COUPONS_JSON || "").trim();
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const c of arr) {
          if (!c || typeof c !== "object") continue;
          const code = normalizeCouponCode((c as any).code);
          const type = (c as any).type as CouponType;
          const value = Number((c as any).value);
          if (!code) continue;
          if (
            type !== "percent" &&
            type !== "fixed" &&
            type !== "target_total"
          )
            continue;
          if (!Number.isFinite(value) || value <= 0) continue;

          defs.push({
            code,
            active:
              typeof (c as any).active === "boolean"
                ? (c as any).active
                : true,
            type,
            value,
            starts_at:
              typeof (c as any).starts_at === "string"
                ? (c as any).starts_at
                : undefined,
            ends_at:
              typeof (c as any).ends_at === "string"
                ? (c as any).ends_at
                : undefined,
            min_total: Number.isFinite(Number((c as any).min_total))
              ? Number((c as any).min_total)
              : undefined,
            plans: Array.isArray((c as any).plans)
              ? (c as any).plans
              : undefined,
            billings: Array.isArray((c as any).billings)
              ? (c as any).billings
              : undefined,
          });
        }
      }
    } catch {
      // ignora env inválida
    }
  }

  return defs;
}

// =========================
// FIX: tipagem do retorno do evaluateCoupon (union discriminado)
// Isso resolve o "finalCents vermelho" no POST, porque o TS estreita corretamente após "if (!couponEval.ok) return"
// =========================
type CouponEvalOk = {
  ok: true;
  applied: boolean;
  code: string | null;
  discountCents: number;
  finalCents: number;
  label: string | null;
  type: CouponType | null;
};
type CouponEvalErr = { ok: false; message: string };
type CouponEvalResult = CouponEvalOk | CouponEvalErr;

function evaluateCoupon(args: {
  code: string;
  plan: Plan;
  billing: Billing;
  baseCents: number;
}): CouponEvalResult {
  const { code, plan, billing, baseCents } = args;

  if (!code) {
    return {
      ok: true,
      applied: false,
      code: null as string | null,
      discountCents: 0,
      finalCents: baseCents,
      label: null as string | null,
      type: null as CouponType | null,
    };
  }

  const coupons = loadCoupons();
  const def = coupons.find((c) => c.code === code);

  if (!def || def.active === false)
    return { ok: false, message: "Cupom inválido ou inativo." };

  const now = Date.now();
  const startMs = parseIsoToMs(def.starts_at);
  const endMs = parseIsoToMs(def.ends_at);
  if (startMs && now < startMs)
    return { ok: false, message: "Cupom ainda não começou." };
  if (endMs && now > endMs) return { ok: false, message: "Cupom expirado." };

  if (Array.isArray(def.plans) && def.plans.length && !def.plans.includes(plan)) {
    return { ok: false, message: "Cupom não é válido para este plano." };
  }
  if (
    Array.isArray(def.billings) &&
    def.billings.length &&
    !def.billings.includes(billing)
  ) {
    return { ok: false, message: "Cupom não é válido para esta recorrência." };
  }

  const minTotalCents = def.min_total ? toCents(def.min_total) : 0;
  if (minTotalCents && baseCents < minTotalCents)
    return { ok: false, message: "Cupom não atende ao valor mínimo." };

  let finalCents = baseCents;

  if (def.type === "percent") {
    const pct = Math.min(100, Math.max(0, def.value));
    const discount = Math.round((baseCents * pct) / 100);
    finalCents = baseCents - discount;
  } else if (def.type === "fixed") {
    const discount = toCents(def.value);
    finalCents = baseCents - discount;
  } else if (def.type === "target_total") {
    // segurança: nunca deixa cupom aumentar valor final
    finalCents = Math.min(baseCents, toCents(def.value));
  }

  // MP não aceita 0.00
  finalCents = Math.max(finalCents, 1);

  const discountCents = Math.max(0, baseCents - finalCents);

  return {
    ok: true,
    applied: true,
    code,
    discountCents,
    finalCents,
    label: `Cupom (${code})`,
    type: def.type,
  };
}

function onlyDigits(v: string) {
  return (v || "").replace(/\D/g, "");
}

function splitName(full: string) {
  const clean = (full || "").trim().replace(/\s+/g, " ");
  if (!clean) return { first_name: "", last_name: "" };
  const parts = clean.split(" ");
  const first_name = parts[0] || "";
  const last_name = parts.slice(1).join(" ") || "";
  return { first_name, last_name };
}

function isValidEmailBasic(v: string) {
  const s = (v || "").trim();
  if (!s) return false;
  if (s.length > 180) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function normalizeText(v: any, max = 120) {
  const s = typeof v === "string" ? v : "";
  return s.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, max);
}

function normalizeOrderId(v: any) {
  const raw = typeof v === "string" ? v.trim() : "";
  if (!raw) return null;
  if (raw.length > 64) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(raw)) return null;
  return raw;
}

function normalizeRevision(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const i = Math.floor(n);
  if (i < 0) return 0;
  if (i > 1_000_000) return 1_000_000;
  return i;
}

function normalizePaymentId(v: any) {
  const raw =
    typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  if (!raw) return "";
  const d = raw.replace(/\D/g, "");
  return d.slice(0, 32);
}

function bad(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, message, ...(extra ? { extra } : {}) },
    { status, headers: SECURE_JSON_HEADERS },
  );
}

function isValidCpfDigits(cpfDigits: string) {
  const cpf = onlyDigits(cpfDigits);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calc = (base: string, factor: number) => {
    let total = 0;
    for (let i = 0; i < base.length; i++)
      total += Number(base[i]) * (factor - i);
    const mod = total % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  const d1 = calc(cpf.slice(0, 9), 10);
  const d2 = calc(cpf.slice(0, 9) + String(d1), 11);
  return cpf.endsWith(`${d1}${d2}`);
}

/** =========================
 * MP helpers (robustez)
 * ========================= */

const MP_API_BASE = "https://api.mercadopago.com";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// idempotency key estável (evita duplicar pagamento em spam/cliques/retry)
function stableIdempotencyKey(seed: string) {
  const s = String(seed || "").trim();
  const h = crypto.createHash("sha256").update(s).digest("hex"); // 64 chars
  return h.slice(0, 64);
}

// para log: remove PII
function maskEmail(email: string) {
  const e = (email || "").trim();
  if (!e || !e.includes("@")) return "";
  const [u, d] = e.split("@");
  const uu =
    u.length <= 2
      ? u[0] + "*"
      : u.slice(0, 2) + "*".repeat(Math.min(8, u.length - 2));
  return `${uu}@${d}`;
}
function maskCpf(cpf: string) {
  const d = onlyDigits(cpf || "");
  if (d.length !== 11) return "";
  return `${d.slice(0, 3)}***${d.slice(8)}`;
}
function safeLogPayload(p: any) {
  try {
    const clone = JSON.parse(JSON.stringify(p || {}));
    if (clone?.payer?.email) clone.payer.email = maskEmail(String(clone.payer.email));
    if (clone?.payer?.cpf) clone.payer.cpf = maskCpf(String(clone.payer.cpf));
    if (clone?.payer?.identification?.number)
      clone.payer.identification.number = maskCpf(
        String(clone.payer.identification.number),
      );
    return clone;
  } catch {
    return {};
  }
}

// fetch com timeout/retry (evita erros intermitentes 429/5xx)
async function mpFetch(
  url: string,
  opts: {
    method: string;
    accessToken: string;
    headers?: Record<string, string>;
    body?: any;
    timeoutMs?: number;
    retries?: number;
    idempotencyKey?: string;
  },
) {
  const timeoutMs = Number.isFinite(opts.timeoutMs)
    ? (opts.timeoutMs as number)
    : MP_TIMEOUT_MS;
  const retries = Number.isFinite(opts.retries)
    ? (opts.retries as number)
    : MP_FETCH_RETRIES;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.accessToken}`,
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };

  if (opts.idempotencyKey) {
    headers["X-Idempotency-Key"] = opts.idempotencyKey;
  }

  let lastErr: any = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const t = setTimeout(
      () => controller.abort(),
      Math.max(1000, timeoutMs),
    );

    try {
      const res = await fetch(url, {
        method: opts.method,
        headers,
        body: opts.body != null ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        redirect: "follow",
      });

      clearTimeout(t);

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const isJson = ct.includes("application/json");

      const payload = isJson
        ? await res.json().catch(() => null)
        : await res.text().catch(() => null);

      // sucesso
      if (res.ok)
        return { ok: true as const, status: res.status, payload, headers: res.headers };

      // retry em 429/5xx
      const retriable =
        res.status === 429 || (res.status >= 500 && res.status <= 599);
      if (retriable && attempt < retries) {
        const ra = Number(res.headers.get("retry-after") || "");
        const backoff = Number.isFinite(ra)
          ? Math.max(0.2, ra) * 1000
          : MP_FETCH_RETRY_BASE_MS * (1 + attempt) * (1 + attempt) +
            Math.floor(Math.random() * 150);
        await sleep(backoff);
        continue;
      }

      return { ok: false as const, status: res.status, payload, headers: res.headers };
    } catch (err: any) {
      clearTimeout(t);
      lastErr = err;

      // retry em abort / network
      const isAbort = err?.name === "AbortError";
      if ((isAbort || err) && attempt < retries) {
        const backoff =
          MP_FETCH_RETRY_BASE_MS * (1 + attempt) * (1 + attempt) +
          Math.floor(Math.random() * 150);
        await sleep(backoff);
        continue;
      }
      break;
    }
  }

  return {
    ok: false as const,
    status: null as any,
    payload: lastErr || null,
    headers: null as any,
  };
}

function isCancellableStatus(status: string | null) {
  const s = String(status || "").toLowerCase();
  // approved -> nunca; cancelled -> já
  if (!s) return false;
  if (s === "approved") return false;
  if (s === "cancelled") return false;
  // pendentes típicos
  return (
    s === "pending" ||
    s === "in_process" ||
    s === "authorized" ||
    s === "in_mediation"
  );
}

function isFinalStatus(status: string | null) {
  const s = String(status || "").toLowerCase();
  return (
    s === "approved" ||
    s === "rejected" ||
    s === "cancelled" ||
    s === "refunded" ||
    s === "charged_back"
  );
}

function computePricingFingerprint(args: {
  method: Method;
  plan: Plan;
  billing: Billing;
  total: number;
  coupon?: string | null;
  months: number;
  unit: number;
}) {
  const seed = [
    args.method,
    args.plan,
    args.billing,
    Number(args.total).toFixed(2),
    String(args.coupon || ""),
    String(args.months),
    Number(args.unit).toFixed(2),
  ].join("|");
  return crypto.createHash("sha256").update(seed).digest("hex").slice(0, 24);
}

const intentStore = new Map<
  string,
  { payment_id: string; createdAt: number; fingerprint: string; status?: string | null }
>();

function makeIntentKey(order_id: string, revision: number, method: Method) {
  return `${order_id}::${revision}::${method}`;
}


function getIntent(key: string) {
  const it = intentStore.get(key);
  if (!it) return null;

  const ttlMs = Math.max(10, INTENT_DEDUPE_TTL_SECONDS) * 1000;
  if (Date.now() - it.createdAt > ttlMs) {
    intentStore.delete(key);
    return null;
  }
  return it;
}

function setIntent(
  key: string,
  value: { payment_id: string; fingerprint: string; status?: string | null },
) {
  intentStore.set(key, { ...value, createdAt: Date.now() });
}

// busca pagamentos existentes pelo external_reference (dedupe real no MP)
async function mpSearchByExternalReference(
  accessToken: string,
  external_reference: string,
) {
  const url = new URL(`${MP_API_BASE}/v1/payments/search`);
  url.searchParams.set("external_reference", external_reference);
  url.searchParams.set("sort", "date_created");
  url.searchParams.set("criteria", "desc");
  url.searchParams.set(
    "limit",
    String(Math.max(1, Math.min(50, MP_SEARCH_MAX_RESULTS))),
  );

  const res = await mpFetch(url.toString(), {
    method: "GET",
    accessToken,
    timeoutMs: MP_TIMEOUT_MS,
    retries: MP_FETCH_RETRIES,
  });

  if (!res.ok)
    return { ok: false as const, status: res.status, data: null as any };

  // formato típico: { results: [...], paging: {...} }
  const data = res.payload;
  const results = Array.isArray(data?.results) ? data.results : [];
  return { ok: true as const, status: res.status, data: { results } };
}

async function mpGetPaymentById(accessToken: string, paymentId: string) {
  const id = normalizePaymentId(paymentId);
  if (!id) return { ok: false as const, status: 400, data: null as any };

  const res = await mpFetch(
    `${MP_API_BASE}/v1/payments/${encodeURIComponent(id)}`,
    {
      method: "GET",
      accessToken,
      timeoutMs: MP_TIMEOUT_MS,
      retries: MP_FETCH_RETRIES,
    },
  );

  if (!res.ok) return { ok: false as const, status: res.status, data: res.payload };
  return { ok: true as const, status: res.status, data: res.payload };
}

function attachTraceHeaders(resp: NextResponse, traceId?: string, rl?: any) {
  if (traceId) resp.headers.set("X-Trace-Id", traceId);
  resp.headers.set("Cache-Control", "no-store");
  resp.headers.set("X-Content-Type-Options", "nosniff");
  resp.headers.set("Referrer-Policy", "same-origin");

  // rate headers (úteis p/ debug)
  if (rl?.ip) resp.headers.set("X-RateLimit-Id", String(rl.ip));
  if (typeof rl?.remaining === "number")
    resp.headers.set("X-RateLimit-Remaining", String(rl.remaining));
  if (typeof rl?.resetAt === "number")
    resp.headers.set("X-RateLimit-Reset", String(Math.floor(rl.resetAt / 1000)));

  return resp;
}

function getMpClient(req: NextRequest, forceIdempotencyKey?: string) {
  const accessToken = (process.env.MP_ACCESS_TOKEN || "").trim();
  if (!accessToken) return null;

  const hdrKey = (req.headers.get("x-idempotency-key") || "").trim();
  const idempotencyKey = forceIdempotencyKey || hdrKey || crypto.randomUUID();

  return new MercadoPagoConfig({
    accessToken,
    options: { timeout: Math.max(5000, MP_TIMEOUT_MS), idempotencyKey },
  });
}

function normalizeMethod(m: any): Method | null {
  if (m === "pix" || m === "boleto" || m === "card") return m;
  return null;
}
function normalizePlan(p: any): Plan | null {
  if (p === "starter" || p === "pro" || p === "premium") return p;
  return null;
}
function normalizeBilling(b: any): Billing | null {
  if (b === "monthly" || b === "annual") return b;
  return null;
}

//  anual no checkout/pagamento = 12 meses
function billingMonths(billing: Billing) {
  return billing === "annual" ? 12 : 1;
}

/**
 * Lê cookie "discord_user" (URL-encoded JSON) e retorna email (se existir).
 */
function getDiscordEmail(req: NextRequest) {
  const raw = req.cookies.get("discord_user")?.value || "";
  if (!raw) return null;

  try {
    const decoded = decodeURIComponent(raw);
    const obj = JSON.parse(decoded);
    const email = typeof obj?.email === "string" ? obj.email.trim() : "";
    return email || null;
  } catch {
    return null;
  }
}

/**
 * Normaliza erro do MP (o SDK às vezes joga err.cause como Array)
 */
function extractMpError(err: any) {
  const mpStatus =
    err?.status ??
    err?.cause?.response?.status ??
    err?.cause?.status ??
    null;

  const mpMessage =
    (typeof err?.message === "string" && err.message) ||
    (typeof err?.cause?.message === "string" && err.cause.message) ||
    null;

  const mpData =
    err?.cause?.response?.data ||
    err?.cause?.response?.body ||
    err?.cause ||
    null;

  const causes: any[] = Array.isArray(err?.cause)
    ? err.cause
    : Array.isArray(mpData?.cause)
      ? mpData.cause
      : Array.isArray(err?.cause?.cause)
        ? err.cause.cause
        : [];

  const codes = causes.map((c) => c?.code).filter(Boolean);

  return { mpStatus, mpMessage, mpData, causes, codes };
}

/**
 * NEW: mínimo por método (em centavos)
 */
function getMinFinalCentsForMethod(method: Method) {
  let min = 0;
  if (method === "pix")
    min = Number.isFinite(MP_MIN_PIX_AMOUNT) ? MP_MIN_PIX_AMOUNT : 1;
  else if (method === "boleto")
    min = Number.isFinite(MP_MIN_BOLETO_AMOUNT) ? MP_MIN_BOLETO_AMOUNT : 1;
  else min = 1;

  // nunca abaixo de 0.01 (1 centavo)
  const cents = toCents(Math.max(0.01, min));
  return Math.max(1, cents);
}

/**
 *  CANCELA payment anterior somente quando solicitado
 */
async function tryCancelPayment(
  paymentId: string,
  accessToken: string,
  traceId?: string,
) {
  const pid = normalizePaymentId(paymentId);
  if (!pid) return { ok: false, status: 400, reason: "paymentId inválido" };

  // checa status antes (evita tentativas inúteis)
  try {
    const current = await mpGetPaymentById(accessToken, pid);
    const curStatus = current.ok ? String(current.data?.status ?? "") : null;

    if (curStatus && !isCancellableStatus(curStatus)) {
      return {
        ok: true,
        status: 200,
        skipped: true,
        reason: `não cancelado: status=${curStatus}`,
      };
    }
  } catch {
    // best effort
  }

  // idempotency estável para cancelamento (evita “double cancel” em retry)
  const idKey = stableIdempotencyKey(`cancel|${pid}|${traceId || ""}`);

  try {
    const res = await mpFetch(
      `${MP_API_BASE}/v1/payments/${encodeURIComponent(pid)}`,
      {
        method: "PUT",
        accessToken,
        timeoutMs: MP_TIMEOUT_MS,
        retries: MP_FETCH_RETRIES,
        idempotencyKey: idKey,
        body: { status: "cancelled" },
      },
    );

    if (!res.ok) {
      return {
        ok: false,
        status: res.status ?? null,
        mp_payload: res.payload ?? null,
      };
    }

    return { ok: true, status: res.status ?? 200 };
  } catch {
    return { ok: false, status: null };
  }
}

/**
 * =========================
 * ORIGIN/CORS HARDENING (corrige seu 403 na origem)
 * =========================
 */

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

function isAllowedOrigin(req: NextRequest, candidate: string) {
  const cand = normalizeOrigin(candidate);
  if (!cand) return false;

  const reqOrigin = getRequestOrigin(req);
  const allow = new Set<string>(
    [APP_ORIGIN, reqOrigin, ...ALLOWED_ORIGINS].filter(Boolean) as string[],
  );

  // permitido se estiver no allowlist
  if (allow.has(cand)) return true;

  // permitido se bater com a origem real do request (resolve APP_ORIGIN errado)
  if (reqOrigin && cand === reqOrigin) return true;

  return false;
}

function enforceOrigin(req: NextRequest) {
  // Em dev, não bloqueia
  if (process.env.NODE_ENV !== "production") return true;

  const origin = (req.headers.get("origin") || "").trim();
  const referer = (req.headers.get("referer") || "").trim();

  // Se não veio Origin/Referer (server-to-server), não bloqueia
  if (!origin && !referer) return true;

  if (origin && isAllowedOrigin(req, origin)) return true;
  if (referer && isAllowedOrigin(req, referer)) return true;

  return false;
}

function enforceJson(req: NextRequest) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  return ct.includes("application/json");
}

function buildExpirationIso(method: Method) {
  try {
    const now = Date.now();

    if (method === "pix") {
      const mins = Number.isFinite(MP_PIX_EXPIRATION_MINUTES)
        ? MP_PIX_EXPIRATION_MINUTES
        : 60;
      if (mins <= 0) return undefined;
      return new Date(now + mins * 60 * 1000).toISOString();
    }

    if (method === "boleto") {
      const days = Number.isFinite(MP_BOLETO_EXPIRATION_DAYS)
        ? MP_BOLETO_EXPIRATION_DAYS
        : 3;
      if (days <= 0) return undefined;
      return new Date(now + days * 24 * 60 * 60 * 1000).toISOString();
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/** =========================
 * COMPROVANTE (PDF)
 * ========================= */

function b64urlEncode(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
function b64urlDecodeToBuffer(s: string) {
  const pad = (4 - (s.length % 4)) % 4;
  const base64 = (s + "=".repeat(pad)).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64");
}

function signHmac(data: string) {
  if (!RECEIPT_SECRET) return "";
  return b64urlEncode(
    crypto.createHmac("sha256", RECEIPT_SECRET).update(data).digest(),
  );
}

function makeReceiptToken(paymentId: string) {
  const pid = String(paymentId || "").trim();
  const days = Number.isFinite(RECEIPT_TOKEN_DAYS) ? RECEIPT_TOKEN_DAYS : 14;
  const exp = Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000;

  const payload = { pid, exp };
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = signHmac(payloadB64);
  return `${payloadB64}.${sig}`;
}

function verifyReceiptToken(token: string, expectedPaymentId: string) {
  try {
    const t = String(token || "").trim();
    if (!t.includes(".")) return { ok: false, reason: "token inválido" };

    const [payloadB64, sig] = t.split(".", 2);
    if (!payloadB64 || !sig) return { ok: false, reason: "token inválido" };

    const sig2 = signHmac(payloadB64);

    const a = Buffer.from(sig, "utf8");
    const b = Buffer.from(sig2, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
      return { ok: false, reason: "assinatura inválida" };

    const payloadJson = b64urlDecodeToBuffer(payloadB64).toString("utf8");
    const payload = JSON.parse(payloadJson) as { pid?: string; exp?: number };

    const pid = String(payload?.pid || "").trim();
    const exp = Number(payload?.exp);

    if (!pid || pid !== String(expectedPaymentId || "").trim())
      return { ok: false, reason: "token não pertence ao payment" };
    if (!Number.isFinite(exp) || Date.now() > exp)
      return { ok: false, reason: "token expirado" };

    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "token inválido" };
  }
}

function formatBRL(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);
}

function formatDateBR(iso: any) {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stripDataUrlBase64(b64: string) {
  const s = String(b64 || "").trim();
  if (!s) return "";
  const m = s.match(/^data:.*?;base64,(.*)$/i);
  return m ? m[1] : s;
}

async function generateReceiptPdf(mpRes: any): Promise<Uint8Array> {
  const id = String(mpRes?.id ?? "");
  const amount = Number(mpRes?.transaction_amount ?? 0);
  const status = String(mpRes?.status ?? "");
  const statusDetail = String(mpRes?.status_detail ?? "");
  const created = mpRes?.date_created ?? null;
  const externalRef = String(mpRes?.external_reference ?? "");
  const pmid = String(mpRes?.payment_method_id ?? "");

  const metadata = mpRes?.metadata || {};
  const plan = metadata?.plan ? String(metadata.plan) : "";
  const billing = metadata?.billing ? String(metadata.billing) : "";
  const coupon = metadata?.coupon ? String(metadata.coupon) : "";
  const traceId = metadata?.trace_id ? String(metadata.trace_id) : "";

  const tx = mpRes?.point_of_interaction?.transaction_data || {};
  const qrBase64 = tx?.qr_code_base64 ? String(tx.qr_code_base64) : "";

  const authSeed = `${id}|${amount}|${created || ""}|${externalRef || ""}`;
  const auth = crypto
    .createHash("sha256")
    .update(authSeed)
    .digest("hex")
    .toUpperCase()
    .slice(0, 24);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  let y = height - margin;

  // Header
  page.drawText("Comprovante de Pagamento", {
    x: margin,
    y,
    size: 18,
    font: fontBold,
    color: rgb(0.08, 0.1, 0.12),
  });

  y -= 12;
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: rgb(0.85, 0.87, 0.9),
  });

  y -= 26;

  const leftX = margin;

  function row(label: string, value: string) {
    const v = (value || "").trim() || "-";
    page.drawText(label, {
      x: leftX,
      y,
      size: 10.5,
      font,
      color: rgb(0.35, 0.38, 0.42),
    });
    page.drawText(v, {
      x: leftX,
      y: y - 14,
      size: 12,
      font: fontBold,
      color: rgb(0.08, 0.1, 0.12),
    });
    y -= 40;
  }

  row("Valor", formatBRL(amount));
  row(
    "Status",
    status ? `${status}${statusDetail ? ` • ${statusDetail}` : ""}` : "-",
  );
  row("Método", pmid || "-");
  row("Data", formatDateBR(created) || "-");
  row("ID do pagamento", id || "-");
  if (externalRef) row("Referência", externalRef);
  if (plan || billing)
    row("Plano", `${plan || "-"}${billing ? ` • ${billing}` : ""}`);
  if (coupon) row("Cupom", coupon);

  // QR (se tiver)
  if (qrBase64) {
    try {
      const raw = stripDataUrlBase64(qrBase64);
      const bytes = Uint8Array.from(Buffer.from(raw, "base64"));
      const png = await pdfDoc.embedPng(bytes);

      const size = 150;
      const imgX = width - margin - size;
      const imgY = height - margin - 230;

      page.drawRectangle({
        x: imgX - 10,
        y: imgY - 10,
        width: size + 20,
        height: size + 20,
        borderColor: rgb(0.85, 0.87, 0.9),
        borderWidth: 1,
      });

      page.drawImage(png, { x: imgX, y: imgY, width: size, height: size });

      page.drawText("QR Pix", {
        x: imgX,
        y: imgY - 18,
        size: 10,
        font,
        color: rgb(0.35, 0.38, 0.42),
      });
    } catch {
      // ignora se falhar
    }
  }

  // Footer
  const footerY = margin + 38;
  page.drawLine({
    start: { x: margin, y: footerY + 22 },
    end: { x: width - margin, y: footerY + 22 },
    thickness: 1,
    color: rgb(0.85, 0.87, 0.9),
  });

  page.drawText("Autenticação", {
    x: margin,
    y: footerY + 4,
    size: 10,
    font,
    color: rgb(0.35, 0.38, 0.42),
  });

  page.drawText(auth.match(/.{1,4}/g)?.join(" ") || auth, {
    x: margin,
    y: footerY - 12,
    size: 12,
    font: fontBold,
    color: rgb(0.08, 0.1, 0.12),
  });

  page.drawText(
    `Gerado automaticamente${traceId ? ` • trace ${traceId}` : ""}`,
    {
      x: margin,
      y: margin,
      size: 9,
      font,
      color: rgb(0.45, 0.48, 0.52),
    },
  );

  return await pdfDoc.save();
}

function buildReceiptUrl(paymentId: string, token: string) {
  const path = `/api/pagment?receipt=1&id=${encodeURIComponent(paymentId)}&token=${encodeURIComponent(token)}`;
  return APP_ORIGIN ? `${APP_ORIGIN}${path}` : path;
}

//  whitelist simples (segurança): só aceita baixar/redirecionar para hosts do MP
function isAllowedMpHost(urlStr: string) {
  try {
    const u = new URL(urlStr);
    const h = u.hostname.toLowerCase();
    return (
      h === "mpago.la" ||
      h.endsWith(".mpago.la") ||
      h === "mercadopago.com" ||
      h.endsWith(".mercadopago.com") ||
      h === "mercadopago.com.br" ||
      h.endsWith(".mercadopago.com.br")
    );
  } catch {
    return false;
  }
}

function collectReceiptCandidates(mpRes: any): string[] {
  const tx = mpRes?.point_of_interaction?.transaction_data || {};
  const td = mpRes?.transaction_details || {};

  const cands = [
    mpRes?.receipt_url, // raríssimo (mas se vier, ótimo)
    tx?.ticket_url,
    tx?.external_resource_url,
    td?.external_resource_url,
    mpRes?.point_of_interaction?.transaction_data?.ticket_url,
    mpRes?.transaction_details?.external_resource_url,
  ]
    .map((v: any) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

  // filtra só urls confiáveis do MP
  return cands.filter((u) => isAllowedMpHost(u));
}

async function tryStreamMpPdfOrRedirect(candidates: string[], filename: string) {
  for (const url of candidates) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      const ct = (res.headers.get("content-type") || "").toLowerCase();

      // Se vier PDF, streama como download
      if (res.ok && (ct.includes("application/pdf") || ct.includes("pdf"))) {
        const ab = await res.arrayBuffer();
        return new NextResponse(ab, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      // Se não for PDF, redireciona pro link oficial (muito comum em boleto/pix ticket)
      if (res.ok) {
        const resp = NextResponse.redirect(url, { status: 302 });
        resp.headers.set("Cache-Control", "no-store");
        resp.headers.set("X-Content-Type-Options", "nosniff");
        return resp;
      }
    } catch {
      // tenta próximo
    }
  }
  return null;
}

/**
 * OPTIONS /api/pagment
 * (preflight / compat)
 */
export async function OPTIONS() {
  const resp = new NextResponse(null, { status: 204 });
  resp.headers.set("Cache-Control", "no-store");
  resp.headers.set("X-Content-Type-Options", "nosniff");
  resp.headers.set("Referrer-Policy", "same-origin");
  return resp;
}

/**
 * GET /api/pagment?id=123
 * ou
 * GET /api/pagment?receipt=1&id=123&token=...
 */
export async function GET(req: NextRequest) {
  const rl = rateLimit(req, "GET");
  if (!rl.ok) {
    const r = bad("Muitas requisições. Tente novamente em alguns segundos.", 429, {
      retry_after_sec: rl.retryAfterSec,
    });
    return attachTraceHeaders(r, undefined, rl);
  }

  try {
    const client = getMpClient(req);
    if (!client) {
      const r = bad("MP_ACCESS_TOKEN não configurado no .env.local", 500);
      return attachTraceHeaders(r, undefined, rl);
    }

    const { searchParams } = new URL(req.url);
    const idRaw = (searchParams.get("id") || "").trim();
    const id = normalizePaymentId(idRaw);
    if (!id) {
      const r = bad("Parâmetro 'id' é obrigatório.", 400);
      return attachTraceHeaders(r, undefined, rl);
    }

    const isReceipt = (searchParams.get("receipt") || "").trim() === "1";

    const payment = new Payment(client);
    const mpRes: any = await payment.get({ id });

    const tx = mpRes?.point_of_interaction?.transaction_data || {};
    const qr_code = tx?.qr_code || null;
    const qr_code_base64 = tx?.qr_code_base64 || null;

    const ticket_url =
      tx?.ticket_url ||
      tx?.external_resource_url ||
      mpRes?.transaction_details?.external_resource_url ||
      mpRes?.point_of_interaction?.transaction_data?.ticket_url ||
      null;

    const barcode =
      tx?.barcode?.content ||
      mpRes?.barcode?.content ||
      mpRes?.transaction_details?.barcode ||
      null;

    //  modo comprovante (PDF)
    if (isReceipt) {
      // Em produção, exige token válido
      if (process.env.NODE_ENV === "production") {
        const token = (searchParams.get("token") || "").trim();
        if (!token) {
          const r = bad("Token do comprovante é obrigatório.", 403);
          return attachTraceHeaders(r, undefined, rl);
        }

        const v = verifyReceiptToken(token, id);
        if (!v.ok) {
          const r = bad(`Token inválido: ${v.reason}`, 403);
          return attachTraceHeaders(r, undefined, rl);
        }
      }

      // 1) Tenta usar o que o MP fornece (PDF/segunda via/link oficial)
      const candidates = collectReceiptCandidates(mpRes);
      const mpName =
        mpRes?.payment_method_id === "bolbradesco"
          ? `boleto-${id}.pdf`
          : `comprovante-${id}.pdf`;
      const streamedOrRedirected = await tryStreamMpPdfOrRedirect(
        candidates,
        mpName,
      );
      if (streamedOrRedirected) return streamedOrRedirected;

      // 2) Fallback: gera PDF no backend (profissional)
      const pdfBytes = await generateReceiptPdf(mpRes);

      //  “pdfBytes vermelho” resolve aqui: retorna Buffer
      const resp = new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="comprovante-${id}.pdf"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
      return attachTraceHeaders(resp, String(mpRes?.metadata?.trace_id || ""), rl);
    }

    //  modo normal (polling)
    const resp = NextResponse.json(
      {
        ok: true,
        id: mpRes?.id ?? id,
        status: mpRes?.status ?? null,
        status_detail: mpRes?.status_detail ?? null,
        payment_method_id: mpRes?.payment_method_id ?? null,

        transaction_amount: mpRes?.transaction_amount ?? null,
        metadata: mpRes?.metadata ?? null,
        external_reference: mpRes?.external_reference ?? null,

        qr_code,
        qr_code_base64,
        ticket_url,
        barcode,

        date_created: mpRes?.date_created ?? null,
        date_of_expiration: mpRes?.date_of_expiration ?? null,
      },
      { status: 200, headers: SECURE_JSON_HEADERS },
    );

    return attachTraceHeaders(resp, String(mpRes?.metadata?.trace_id || ""), rl);
  } catch (err: any) {
    const mp = extractMpError(err);
    console.error("[GET /api/pagment] error:", { message: err?.message, mp });

    const resp = NextResponse.json(
      {
        ok: false,
        message: err?.message || "Erro ao consultar pagamento.",
        mp_error: mp,
      },
      { status: 500, headers: SECURE_JSON_HEADERS },
    );

    return attachTraceHeaders(resp, undefined, rl);
  }
}

/**
 * POST /api/pagment
 *
 *  NÃO cancela automaticamente ao trocar/remover cupom
 *  Só cancela se body.cancel_previous === true (ex: quando detectar F5/reload no front)
 *  Retorna receipt_url + receipt_token (PDF profissional / ou link oficial do MP quando existir)
 */
export async function POST(req: NextRequest) {
  const traceId = crypto.randomUUID();

  const rl = rateLimit(req, "POST");
  if (!rl.ok) {
    const r = bad("Muitas requisições. Tente novamente em alguns segundos.", 429, {
      traceId,
      retry_after_sec: rl.retryAfterSec,
    });
    return attachTraceHeaders(r, traceId, rl);
  }

  try {
    if (!enforceBodySize(req)) {
      const r = bad("Payload muito grande.", 413, { traceId });
      return attachTraceHeaders(r, traceId, rl);
    }
    if (!enforceOrigin(req)) {
      const r = bad("Origem não permitida.", 403, {
        traceId,
        debug: {
          origin: (req.headers.get("origin") || "").trim() || null,
          referer: (req.headers.get("referer") || "").trim() || null,
          app_origin: APP_ORIGIN || null,
          allowed_origins: ALLOWED_ORIGINS,
          request_origin: getRequestOrigin(req),
        },
      });
      return attachTraceHeaders(r, traceId, rl);
    }
    if (!enforceJson(req)) {
      const r = bad("Content-Type deve ser application/json.", 415, { traceId });
      return attachTraceHeaders(r, traceId, rl);
    }

    // leitura mais segura do body (mesmo sem content-length)
    let body: any;
    try {
      const raw = await req.text();
      if (raw && raw.length > MAX_BODY_BYTES) {
        const r = bad("Payload muito grande.", 413, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }
      body = raw ? JSON.parse(raw) : {};
    } catch {
      const r = bad("Body inválido (JSON).", 400, { traceId });
      return attachTraceHeaders(r, traceId, rl);
    }

    const method = normalizeMethod(body?.method);
    const plan = normalizePlan(body?.plan);
    const billing = normalizeBilling(body?.billing);

    if (!method || !plan || !billing) {
      const r = bad("Payload inválido: method/plan/billing inválidos ou ausentes.", 400, {
        traceId,
        received: { method: body?.method, plan: body?.plan, billing: body?.billing },
      });
      return attachTraceHeaders(r, traceId, rl);
    }

    //  unit do plano (anual aqui é "por mês")
    const unitAmount = PLAN_PRICES[billing]?.[plan];
    if (!unitAmount || unitAmount <= 0) {
      const r = bad("Plano/recorrência inválidos.", 400, { traceId });
      return attachTraceHeaders(r, traceId, rl);
    }

    //  total cobrado (anual = 12 meses)
    const months = billingMonths(billing);
    const amount = Number((unitAmount * months).toFixed(2));
    if (!amount || amount <= 0) {
      const r = bad("Plano/recorrência inválidos.", 400, { traceId });
      return attachTraceHeaders(r, traceId, rl);
    }

    const planTitle = normalizeText(body?.planTitle, 80) || "Plano";
    const planDescription = normalizeText(body?.planDescription, 140);

    const billingLabel = billing === "annual" ? "Anual (12 meses)" : "Mensal";

    const description =
      planTitle + ` - ${billingLabel}` + (planDescription ? ` • ${planDescription}` : "");

    const discordEmail = getDiscordEmail(req);

    //  Prioriza o email enviado no body (boleto), fallback pro discord
    const payerEmail = (String(body?.payer?.email || "").trim() || discordEmail || "").trim();

    const payerCpf = onlyDigits(String(body?.payer?.cpf || ""));
    const payerName = String(body?.payer?.name || "").trim().replace(/\s+/g, " ").trim();

    //  controle: só cancela anterior quando front mandar (ex: F5/reload)
    const cancel_previous = body?.cancel_previous === true;

    const couponCode = normalizeCouponCode(body?.coupon);

    //  base agora é o TOTAL (anual = 12 meses)
    const baseCents = toCents(amount);

    const couponEval = evaluateCoupon({ code: couponCode, plan, billing, baseCents });
    if (!couponEval.ok) {
      const r = bad(couponEval.message || "Cupom inválido.", 422, { traceId, coupon: couponCode });
      return attachTraceHeaders(r, traceId, rl);
    }

    // =========================
    // NEW: ajusta mínimo por método (evita bloqueio 403 PolicyAgent em total muito baixo)
    // =========================
    let finalCents = couponEval.finalCents;
    let discountCents = couponEval.discountCents;

    const minFinalCents = getMinFinalCentsForMethod(method);
    if (finalCents < minFinalCents) {
      finalCents = minFinalCents;
      discountCents = Math.max(0, baseCents - finalCents);
    }

    const pricing = {
      base: centsToNumber(baseCents), // total cheio (anual = 12 meses)
      discount: centsToNumber(discountCents),
      total: centsToNumber(finalCents), // total final (anual = 12 meses) (já com mínimo aplicado)
      coupon: couponEval.applied ? couponCode : null,
      label: couponEval.applied ? couponEval.label : null,
      type: couponEval.applied ? couponEval.type : null,

      // info extra (útil no front/log)
      unit: Number(unitAmount.toFixed(2)), // preço "por mês" (cards)
      months,
    };

    // fingerprint do preço (ajuda a evitar retornar pagamento errado em dedupe)
    const pricingFingerprint = computePricingFingerprint({
      method,
      plan,
      billing,
      total: pricing.total,
      coupon: pricing.coupon,
      months: pricing.months,
      unit: pricing.unit,
    });

    console.log(
      "[POST /api/pagment] traceId:",
      traceId,
      "payload:",
      safeLogPayload({
        method,
        plan,
        billing,
        pricing,
        fingerprint: pricingFingerprint,
        cancel_previous,
        payer: {
          email: payerEmail,
          cpf: payerCpf,
          name: payerName || "",
          discordEmailFound: !!discordEmail,
        },
      }),
    );

    const accessToken = (process.env.MP_ACCESS_TOKEN || "").trim();
    const isTestToken = accessToken.startsWith("TEST-");
    const looksProdToken = accessToken.startsWith("APP_USR-");

    if (!accessToken) {
      const r = bad("MP_ACCESS_TOKEN não configurado no .env.local", 500, { traceId });
      return attachTraceHeaders(r, traceId, rl);
    }

    // NEW: aviso rápido se token tem cara de “estranho”
    if (!isTestToken && !looksProdToken) {
      // não bloqueia, só ajuda no diagnóstico
      console.warn(
        "[MP token] traceId:",
        traceId,
        "token não parece TEST- nem APP_USR- (verifique se está correto).",
      );
    }

    // Validações fortes por método
    if (method === "pix") {
      if (!payerEmail) {
        const r = bad("Email do pagador é obrigatório.", 400, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }
      if (!isValidEmailBasic(payerEmail)) {
        const r = bad("Email do pagador inválido.", 400, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }
      if (!payerCpf || payerCpf.length !== 11) {
        const r = bad("CPF do pagador inválido.", 400, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }
      if (!isValidCpfDigits(payerCpf)) {
        const r = bad("CPF do pagador inválido.", 400, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }
      if (!payerName || payerName.length < 3) {
        const r = bad("Nome do pagador é obrigatório.", 400, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }

      if (isTestToken) {
        const r = bad(
          "Seu MP_ACCESS_TOKEN parece ser de TESTE (TEST-...). Pix/QR pode falhar em modo teste. Use credencial de PRODUÇÃO e uma conta com Pix habilitado.",
          422,
          { traceId },
        );
        return attachTraceHeaders(r, traceId, rl);
      }
    }

    if (method === "boleto") {
      if (!payerEmail) {
        const r = bad("Email do pagador é obrigatório.", 400, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }
      if (!isValidEmailBasic(payerEmail)) {
        const r = bad("Email do pagador inválido.", 400, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }
      if (!payerCpf || payerCpf.length !== 11) {
        const r = bad("CPF do pagador inválido.", 400, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }
      if (!isValidCpfDigits(payerCpf)) {
        const r = bad("CPF do pagador inválido.", 400, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }
      if (!payerName || payerName.length < 3) {
        const r = bad("Nome do pagador é obrigatório.", 400, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }

      const np = splitName(payerName);
      if (!np.last_name) {
        const r = bad("Para boleto, informe nome e sobrenome.", 400, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }

      if (isTestToken) {
        const r = bad(
          "Seu MP_ACCESS_TOKEN parece ser de TESTE (TEST-...). Boleto/Pix podem ter limitações. Se der erro, teste com credencial de PRODUÇÃO.",
          422,
          { traceId },
        );
        return attachTraceHeaders(r, traceId, rl);
      }
    }

    if (method === "pix" || method === "boleto") {
      const incomingOrder = normalizeOrderId(body?.order_id);
      const order_id = incomingOrder || crypto.randomUUID();

      const revision = normalizeRevision(body?.revision);

      const replace_payment_id = normalizePaymentId(body?.replace_payment_id);

      const external_reference = `order:${order_id}:rev:${revision}`;

      const createIdempotencyKey = stableIdempotencyKey(
        `create|${external_reference}|${method}|${pricingFingerprint}|${payerCpf}|${payerEmail}`,
      );

      const client = getMpClient(req, createIdempotencyKey);
      if (!client) {
        const r = bad("MP_ACCESS_TOKEN não configurado no .env.local", 500, { traceId });
        return attachTraceHeaders(r, traceId, rl);
      }

      const payment = new Payment(client);

      const payment_method_id = method === "pix" ? "pix" : "bolbradesco";

      let boletoAddress: MpBoletoAddress | null = null;

      if (method === "boleto") {
        const addr = normalizeMpBoletoAddress(body?.payer?.address);
        if (!addr.ok) {
          const r = bad(
            "Para gerar boleto registrado, informe endereço completo (CEP, Rua, Número, Bairro, Cidade e UF).",
            400,
            { traceId, missing: addr.missing },
          );
          return attachTraceHeaders(r, traceId, rl);
        }
        boletoAddress = addr.address;
      }

      const payer: any = {
        email: payerEmail,
        identification: { type: "CPF", number: payerCpf },
      };

      if (payerName) {
        const { first_name, last_name } = splitName(payerName);
        payer.first_name = first_name || undefined;
        payer.last_name = last_name || undefined;
      }

      if (method === "boleto" && boletoAddress) {
        payer.address = boletoAddress;
      }

      const intentKey = makeIntentKey(order_id, revision, method);
      const existingIntent = getIntent(intentKey);
      if (existingIntent && existingIntent.fingerprint === pricingFingerprint) {
        try {
          const check = await mpGetPaymentById(accessToken, existingIntent.payment_id);
          if (check.ok) {
            const st = String(check.data?.status ?? "");
            if (!isFinalStatus(st)) {
              const tx0 = check.data?.point_of_interaction?.transaction_data || {};
              const qr_code0 = tx0?.qr_code || null;
              const qr_code_base640 = tx0?.qr_code_base64 || null;
              const ticket_url0 =
                tx0?.ticket_url ||
                tx0?.external_resource_url ||
                check.data?.transaction_details?.external_resource_url ||
                check.data?.point_of_interaction?.transaction_data?.ticket_url ||
                null;
              const barcode0 =
                tx0?.barcode?.content ||
                check.data?.barcode?.content ||
                check.data?.transaction_details?.barcode ||
                null;

              const pid = String(check.data?.id ?? existingIntent.payment_id);
              const receipt_token0 = makeReceiptToken(pid);
              const receipt_url0 = pid ? buildReceiptUrl(pid, receipt_token0) : null;

              const resp = NextResponse.json(
                {
                  ok: true,
                  deduped: true,
                  method,
                  id: pid,
                  status: check.data?.status ?? null,
                  status_detail: check.data?.status_detail ?? null,

                  qr_code: qr_code0,
                  qr_code_base64: qr_code_base640,
                  ticket_url: ticket_url0,
                  barcode: barcode0,

                  external_reference: check.data?.external_reference ?? external_reference,
                  traceId,

                  pricing,
                  order_id,
                  revision,

                  cancelInfo: {
                    ok: true,
                    skipped: true,
                    reason: "dedupe local: retornou pagamento existente (ainda não final).",
                    replace_payment_id: existingIntent.payment_id,
                  },

                  date_of_expiration: check.data?.date_of_expiration ?? null,

                  receipt_url: receipt_url0,
                  receipt_token: receipt_token0,
                },
                { status: 200, headers: SECURE_JSON_HEADERS },
              );
              return attachTraceHeaders(resp, traceId, rl);
            }
          }
        } catch {
          // segue fluxo normal
        }
      }

      try {
        const search = await mpSearchByExternalReference(accessToken, external_reference);
        if (search.ok) {
          const results = Array.isArray(search.data?.results) ? search.data.results : [];

          const candidate = results.find((p: any) => {
            const st = String(p?.status ?? "");
            if (String(st).toLowerCase() === "cancelled") return false;

            const fp = p?.metadata?.pricing_fingerprint
              ? String(p.metadata.pricing_fingerprint)
              : "";
            if (fp && fp !== pricingFingerprint) return false;

            const pmid = String(p?.payment_method_id ?? "");
            if (method === "pix" && pmid && pmid !== "pix") return false;
            if (method === "boleto" && pmid && pmid !== "bolbradesco") return false;

            return true;
          });

          if (candidate?.id) {
            const st = String(candidate?.status ?? "");
            if (!isFinalStatus(st)) {
              const tx0 = candidate?.point_of_interaction?.transaction_data || {};
              const qr_code0 = tx0?.qr_code || null;
              const qr_code_base640 = tx0?.qr_code_base64 || null;

              const ticket_url0 =
                tx0?.ticket_url ||
                tx0?.external_resource_url ||
                candidate?.transaction_details?.external_resource_url ||
                candidate?.point_of_interaction?.transaction_data?.ticket_url ||
                null;

              const barcode0 =
                tx0?.barcode?.content ||
                candidate?.barcode?.content ||
                candidate?.transaction_details?.barcode ||
                null;

              const pid = String(candidate?.id);
              setIntent(intentKey, { payment_id: pid, fingerprint: pricingFingerprint, status: st });

              const receipt_token0 = makeReceiptToken(pid);
              const receipt_url0 = pid ? buildReceiptUrl(pid, receipt_token0) : null;

              const resp = NextResponse.json(
                {
                  ok: true,
                  deduped: true,
                  method,
                  id: pid,
                  status: candidate?.status ?? null,
                  status_detail: candidate?.status_detail ?? null,

                  qr_code: qr_code0,
                  qr_code_base64: qr_code_base640,
                  ticket_url: ticket_url0,
                  barcode: barcode0,

                  external_reference: candidate?.external_reference ?? external_reference,
                  traceId,

                  pricing,
                  order_id,
                  revision,

                  cancelInfo: {
                    ok: true,
                    skipped: true,
                    reason: "dedupe MP: retornou pagamento existente (ainda não final) por external_reference.",
                    replace_payment_id: pid,
                  },

                  date_of_expiration: candidate?.date_of_expiration ?? null,

                  receipt_url: receipt_url0,
                  receipt_token: receipt_token0,
                },
                { status: 200, headers: SECURE_JSON_HEADERS },
              );
              return attachTraceHeaders(resp, traceId, rl);
            }
          }
        }
      } catch {
        // segue fluxo normal
      }

      let cancelInfo: any = null;
      if (cancel_previous && replace_payment_id) {
        try {
          let canCancel = true;
          let oldStatus: string | null = null;

          try {
            const old = await mpGetPaymentById(accessToken, replace_payment_id);
            if (old.ok) {
              oldStatus = old.data?.status ?? null;

              const oldOrderId = old.data?.metadata?.order_id;
              if (oldOrderId && String(oldOrderId) !== String(order_id)) {
                canCancel = false;
                cancelInfo = {
                  replace_payment_id,
                  ok: false,
                  status: null,
                  skipped: true,
                  reason: "replace_payment_id não pertence ao mesmo order_id (metadata).",
                  oldStatus,
                };
              } else if (String(oldStatus || "").toLowerCase() === "approved") {
                canCancel = false;
                cancelInfo = {
                  replace_payment_id,
                  ok: false,
                  status: null,
                  skipped: true,
                  reason: "payment anterior já aprovado; não cancelado.",
                  oldStatus,
                };
              } else if (oldStatus && !isCancellableStatus(oldStatus)) {
                canCancel = false;
                cancelInfo = {
                  replace_payment_id,
                  ok: true,
                  skipped: true,
                  reason: `não cancelado: status não cancelável (${oldStatus}).`,
                  oldStatus,
                };
              }
            }
          } catch {
            // best-effort
          }

          if (canCancel) {
            const cancelled = await tryCancelPayment(replace_payment_id, accessToken, traceId);
            cancelInfo = { replace_payment_id, ...cancelled, oldStatus: oldStatus ?? null };
          }
        } catch {
          cancelInfo = { replace_payment_id, ok: false, status: null };
        }
      } else if (replace_payment_id) {
        cancelInfo = {
          replace_payment_id,
          ok: true,
          skipped: true,
          reason: "não cancelado: troca/remover cupom não cancela pagamentos",
        };
      }

      const expirationIso = buildExpirationIso(method);

      let mpRes: any;

      try {
        const additional_info: any = {
          items: [
            {
              id: `${plan}-${billing}`,
              title: planTitle,
              description: description,
              quantity: 1,
              unit_price: Number(pricing.total),
              category_id: "services",
            },
          ],
          payer: {
            first_name: payer?.first_name || undefined,
            last_name: payer?.last_name || undefined,
            phone: body?.payer?.phone ? String(body.payer.phone).slice(0, 24) : undefined,
          },
        };

        mpRes = await payment.create({
          body: {
            transaction_amount: Number(pricing.total),
            description,
            payment_method_id,
            payer,
            external_reference,
            ...(expirationIso ? { date_of_expiration: expirationIso } : {}),
            metadata: {
              trace_id: traceId,
              plan,
              billing,
              unit_amount: pricing.unit,
              billing_months: pricing.months,
              base_amount: pricing.base,
              discount_amount: pricing.discount,
              final_amount: pricing.total,
              coupon: pricing.coupon,
              coupon_type: pricing.type,
              pricing_fingerprint: pricingFingerprint,
              order_id,
              revision,
              replaced_payment_id: replace_payment_id || null,
              cancel_previous: cancel_previous ? true : false,
            },
            notification_url: process.env.MP_WEBHOOK_URL || undefined,
            additional_info,
          },
        });
      } catch (err: any) {
        const mp = extractMpError(err);

        const msg = String(mp?.mpMessage || err?.message || "");
        const mpStatusNum =
          typeof mp?.mpStatus === "number" && Number.isFinite(mp.mpStatus)
            ? mp.mpStatus
            : null;

        const isNoPixKey =
          mp?.codes?.includes(13253) ||
          /without key enabled/i.test(msg) ||
          /without key enabled/i.test(String((mp as any)?.mpData?.message || ""));

        if (isNoPixKey) {
          const r = bad(
            "Mercado Pago recusou porque sua conta (collector) não está com Pix/QR habilitado para renderizar QR. Ative Pix na conta, cadastre/ative uma chave Pix e use credenciais de PRODUÇÃO da mesma conta. Depois tente novamente.",
            422,
            { traceId, mp_error: mp },
          );
          return attachTraceHeaders(r, traceId, rl);
        }

        const isPolicyUnauthorized =
          (mpStatusNum === 403 && /policy returned unauthorized/i.test(msg)) ||
          /blocked_by/i.test(msg) ||
          /PolicyAgent/i.test(msg);

        if (isPolicyUnauthorized) {
          const r = bad(
            "Mercado Pago bloqueou a criação (PolicyAgent / UNAUTHORIZED). Isso geralmente acontece por política/permissão da conta ou por valor/risco. Verifique se o MP_ACCESS_TOKEN é de PRODUÇÃO e se a conta está habilitada para Pix/Boleto. Se você estiver usando cupom que derruba o total (ex: R$0,01), ajuste MP_MIN_PIX_AMOUNT/MP_MIN_BOLETO_AMOUNT (default R$1,00) no .env.local.",
            403,
            {
              traceId,
              mp_error: mp,
              hint: {
                method,
                total: pricing.total,
                minPix: MP_MIN_PIX_AMOUNT,
                minBoleto: MP_MIN_BOLETO_AMOUNT,
              },
            },
          );
          return attachTraceHeaders(r, traceId, rl);
        }

        console.error("[MP create] traceId:", traceId, "error:", { message: err?.message, mp });

        const statusOut =
          typeof mpStatusNum === "number" && mpStatusNum >= 400 && mpStatusNum <= 599
            ? mpStatusNum
            : 500;

        const resp = NextResponse.json(
          {
            ok: false,
            message: "Erro ao criar pagamento no Mercado Pago.",
            traceId,
            mp_error: mp,
          },
          { status: statusOut, headers: SECURE_JSON_HEADERS },
        );

        return attachTraceHeaders(resp, traceId, rl);
      }

      const createdPaymentId = String(mpRes?.id ?? "");
      if (createdPaymentId) {
        setIntent(intentKey, {
          payment_id: createdPaymentId,
          fingerprint: pricingFingerprint,
          status: mpRes?.status ?? null,
        });
      }

      const tx = mpRes?.point_of_interaction?.transaction_data || {};
      const qr_code = tx?.qr_code || null;
      const qr_code_base64 = tx?.qr_code_base64 || null;

      const ticket_url =
        tx?.ticket_url ||
        tx?.external_resource_url ||
        mpRes?.transaction_details?.external_resource_url ||
        mpRes?.point_of_interaction?.transaction_data?.ticket_url ||
        null;

      const barcode =
        tx?.barcode?.content ||
        mpRes?.barcode?.content ||
        mpRes?.transaction_details?.barcode ||
        null;

      const paymentIdStr = String(mpRes?.id ?? "");
      const receipt_token = makeReceiptToken(paymentIdStr);
      const receipt_url = paymentIdStr ? buildReceiptUrl(paymentIdStr, receipt_token) : null;

      const resp = NextResponse.json(
        {
          ok: true,
          method,
          id: mpRes?.id ?? null,
          status: mpRes?.status ?? null,
          status_detail: mpRes?.status_detail ?? null,

          qr_code,
          qr_code_base64,
          ticket_url,
          barcode,

          external_reference,
          traceId,

          pricing,
          order_id,
          revision,

          cancelInfo,
          date_of_expiration: mpRes?.date_of_expiration ?? expirationIso ?? null,

          receipt_url,
          receipt_token,

          fingerprint: pricingFingerprint,
          idempotency_key_used: createIdempotencyKey,
        },
        { status: 200, headers: SECURE_JSON_HEADERS },
      );

      return attachTraceHeaders(resp, traceId, rl);
    }

    const r = bad(
      "Cartão (checkout transparente) exige tokenização no client (MercadoPago.js/Bricks). Use Pix/Boleto por enquanto.",
      422,
      { traceId },
    );
    return attachTraceHeaders(r, traceId, rl);
  } catch (err: any) {
    const mp = extractMpError(err);
    console.error("[POST /api/pagment] traceId:", traceId, "fatal error:", {
      message: err?.message,
      mp,
    });

    const resp = NextResponse.json(
      { ok: false, message: err?.message || "Erro inesperado no pagamento.", traceId, mp_error: mp },
      { status: 500, headers: SECURE_JSON_HEADERS },
    );

    return attachTraceHeaders(resp, traceId, rl);
  }
}
