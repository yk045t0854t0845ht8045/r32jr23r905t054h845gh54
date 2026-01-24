"use client";

import type React from "react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

type Plan = "starter" | "pro" | "premium";
type Billing = "monthly" | "annual";

interface PayProps {
  open: boolean;
  onClose: () => void;

  plan: Plan;
  billing: Billing;

  planTitle: string;
  planDescription: string;
}

/* ------------------------------------------------------------------ */
/* CONFIG (VOCÊ TROCA OS LINKS) */
/* ------------------------------------------------------------------ */
const PIX_ICON_URL = "/cdn/pay/pix.png";
const BOLETO_ICON_URL = "/cdn/pay/Boleto.svg";
const VISA_LOGO_URL = "/cdn/pay/visa.svg";
const MC_LOGO_URL = "/cdn/pay/mastercard.svg";
const ELO_LOGO_URL = "/cdn/pay/elo.svg";
const AMEX_LOGO_URL = "/cdn/pay/amex.svg";

/* ------------------------------------------------------------------ */
/* TABELA DE PREÇOS (mesma lógica do PriceCard) */
/* ------------------------------------------------------------------ */
const PLAN_PRICES: Record<Billing, Record<Plan, number>> = {
  monthly: {
    starter: 14.9,
    pro: 19.9,
    premium: 22.99,
  },
  annual: {
    starter: 12.49,
    pro: 16.59,
    premium: 20.79,
  },
};

/* ------------------------------------------------------------------ */
/* HELPERS */
/* ------------------------------------------------------------------ */

function normalizeLiveStatus(raw: any): LiveStatus {
  const s = String(raw || "")
    .toLowerCase()
    .trim();

  if (s === "approved" || s === "paid" || s === "succeeded") return "approved";

  // ✅ padroniza canceled/cancelled
  if (s === "canceled" || s === "cancelled" || s === "cancelado")
    return "cancelled";

  if (s === "expired" || s === "expirado") return "expired";

  if (s === "rejected" || s === "refused" || s === "recusado" || s === "failed")
    return "rejected";

  // fallback (pending)
  return "pending";
}

function BankOpenLoader({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <motion.div
      initial={
        reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }
      }
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
      transition={
        reduceMotion ? { duration: 0.12 } : { duration: 0.25, ease: "easeOut" }
      }
      className="w-full max-w-[520px] rounded-3xl border border-white/10 bg-black/55 backdrop-blur-2xl
                 shadow-[0_28px_90px_rgba(0,0,0,0.75)] p-6"
    >
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl border border-white/10 bg-white/[0.04] flex items-center justify-center">
          <IconLock className="text-white/75" />
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-white truncate">
            Preparando seu pagamento
          </div>
          <div className="text-[12px] text-white/45 truncate">
            Aguarde só um instante…
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-center">
        <motion.div
          animate={reduceMotion ? undefined : { rotate: 360 }}
          transition={
            reduceMotion
              ? undefined
              : { repeat: Infinity, duration: 1.05, ease: "linear" }
          }
          className="h-16 w-16 rounded-full border-2 border-white/10 border-t-white/75"
        />
      </div>

      <div className="mt-5 text-center text-[11px] text-white/35">
        Conectando ao provedor e validando sessão…
      </div>
    </motion.div>
  );
}

function safeText(v: unknown, fallback = ""): string {
  if (v == null) return fallback;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);

  // evita crash ao renderizar objeto no JSX
  try {
    const s = JSON.stringify(v);
    if (!s || s === "{}" || s === "[]" || s === "null") return fallback;
    return s;
  } catch {
    return fallback;
  }
}

function safeStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v.trim() ? v : null;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return null; // qualquer objeto vira null (evita React child crash)
}

function normalizePlan(v: unknown): Plan {
  return v === "starter" || v === "pro" || v === "premium" ? v : "starter";
}

function normalizeBilling(v: unknown): Billing {
  return v === "monthly" || v === "annual" ? v : "monthly";
}

function toCents(v: number) {
  return Math.max(0, Math.round((Number(v) + Number.EPSILON) * 100));
}
function centsToNumber(cents: number) {
  const safe = Number.isFinite(cents) ? cents : 0;
  return Number((safe / 100).toFixed(2));
}

function formatCEP(raw: string) {
  const d = onlyDigits(raw).slice(0, 8);
  if (!d) return "";
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5, 8)}`;
}

const UF_CODES = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

function getCookieValue(name: string): string {
  try {
    if (typeof document === "undefined") return "";
    const parts = document.cookie.split(";").map((c) => c.trim());
    const found = parts.find((c) => c.startsWith(`${name}=`));
    if (!found) return "";
    return found.slice(name.length + 1);
  } catch {
    return "";
  }
}

async function readDiscordUserSafe(): Promise<any | null> {
  // 1) tenta cookie (se NÃO for HttpOnly)
  const fromCookie = readDiscordUserFromCookie();
  if (fromCookie) return fromCookie;

  // 2) fallback seguro: server lê cookie e devolve user
  try {
    const res = await fetch("/api/me", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return null;

    const data = await res.json();
    const u = data?.user;
    return u && typeof u === "object" ? u : null;
  } catch {
    return null;
  }
}

function readDiscordUserFromCookie(): any | null {
  const raw = getCookieValue("discord_user");
  if (!raw) return null;

  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function formatBRL(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function onlyDigits(v: string) {
  return v.replace(/\D/g, "");
}

function isValidEmail(v: string) {
  const s = v.trim();
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function formatCPF(raw: string) {
  const d = onlyDigits(raw).slice(0, 11);
  const p1 = d.slice(0, 3);
  const p2 = d.slice(3, 6);
  const p3 = d.slice(6, 9);
  const p4 = d.slice(9, 11);

  if (!d.length) return "";
  if (d.length <= 3) return p1;
  if (d.length <= 6) return `${p1}.${p2}`;
  if (d.length <= 9) return `${p1}.${p2}.${p3}`;
  return `${p1}.${p2}.${p3}-${p4}`;
}

function isValidCPF(rawDigits: string) {
  const cpf = onlyDigits(rawDigits);
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

function luhnCheck(digits: string) {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const d = Number(digits[i]);
    if (Number.isNaN(d)) return false;
    let add = d;
    if (shouldDouble) {
      add = d * 2;
      if (add > 9) add -= 9;
    }
    sum += add;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

type CardBrand = "visa" | "mastercard" | "amex" | "elo" | "other";

/** detecção mais confiável (corrige Mastercard 51–55 e 2221–2720) */
function detectBrand(cardDigits: string): CardBrand {
  const d = onlyDigits(cardDigits);
  if (!d) return "other";

  const p2 = d.length >= 2 ? Number(d.slice(0, 2)) : NaN;
  const p4 = d.length >= 4 ? Number(d.slice(0, 4)) : NaN;

  // AMEX
  if (p2 === 34 || p2 === 37) return "amex";

  // VISA
  if (d[0] === "4") return "visa";

  // Mastercard (51–55, 2221–2720)
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return "mastercard";

  // Elo (cobertura prática)
  if (
    /^(4011(78|79)|431274|438935|451416|457(631|632|393)|504175|506(699|7\d{2})|509\d{3}|627780|636297|636368|650\d{3}|6516\d{2}|6550\d{2})/.test(
      d,
    )
  )
    return "elo";

  return "other";
}

function getCardAllowedLengths(b: CardBrand) {
  if (b === "amex") return [15];
  if (b === "visa") return [13, 16, 19];
  if (b === "mastercard") return [16];
  if (b === "elo") return [16];
  return [16];
}

function formatCardNumber(raw: string) {
  const digits = onlyDigits(raw).slice(0, 19);
  const b = detectBrand(digits);

  // AMEX: 4-6-5
  if (b === "amex") {
    const p1 = digits.slice(0, 4);
    const p2 = digits.slice(4, 10);
    const p3 = digits.slice(10, 15);
    return [p1, p2, p3].filter(Boolean).join(" ");
  }

  const groups = digits.match(/.{1,4}/g) || [];
  return groups.join(" ");
}

function formatExpiry(raw: string) {
  const digits = onlyDigits(raw).slice(0, 4);
  const mm = digits.slice(0, 2);
  const yy = digits.slice(2, 4);
  if (!digits.length) return "";
  if (digits.length <= 2) return mm;
  return `${mm} / ${yy}`;
}

function parseExpiry(exp: string) {
  const d = onlyDigits(exp);
  if (d.length < 4) return null;
  const month = Number(d.slice(0, 2));
  const year2 = Number(d.slice(2, 4));
  if (!Number.isFinite(month) || !Number.isFinite(year2)) return null;
  return { month, year: 2000 + year2 };
}

function formatCvc(raw: string, brand: CardBrand) {
  const max = brand === "amex" ? 4 : 3;
  return onlyDigits(raw).slice(0, max);
}

function safeClipboardWrite(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // fallback
  return new Promise<void>((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

/* ---------------------------- ZIP / ADDRESS ---------------------------- */
type CountryKey =
  | "Brasil"
  | "United States"
  | "Portugal"
  | "Argentina"
  | "Chile";

function countryToZippopotamCode(country: string) {
  if (country === "United States") return "us";
  if (country === "Portugal") return "pt";
  if (country === "Argentina") return "ar";
  if (country === "Chile") return "cl";
  return null;
}

function zipPlaceholder(country: string) {
  if (country === "Brasil") return "00000-000";
  if (country === "United States") return "00000";
  if (country === "Portugal") return "0000-000";
  if (country === "Argentina") return "0000";
  if (country === "Chile") return "0000000";
  return "Postal code";
}

function normalizeZipForDisplay(country: string, raw: string) {
  const d = onlyDigits(raw);
  if (country === "Brasil") {
    const dd = d.slice(0, 8);
    if (dd.length <= 5) return dd;
    return `${dd.slice(0, 5)}-${dd.slice(5, 8)}`;
  }
  if (country === "United States") {
    const dd = d.slice(0, 9);
    if (dd.length <= 5) return dd;
    return `${dd.slice(0, 5)}-${dd.slice(5, 9)}`;
  }
  if (country === "Portugal") {
    const dd = d.slice(0, 7);
    if (dd.length <= 4) return dd;
    return `${dd.slice(0, 4)}-${dd.slice(4, 7)}`;
  }
  if (country === "Argentina") {
    // se vier com letras, mantemos sem formatar agressivo (mas como sóDigits, fica 4)
    return d.slice(0, 4);
  }
  if (country === "Chile") {
    return d.slice(0, 7);
  }
  return raw;
}

function normalizeZipForLookup(country: string, raw: string) {
  const d = onlyDigits(raw);
  if (country === "Brasil") return d.slice(0, 8);
  if (country === "United States") return d.slice(0, 5); // zippopotam usa 5-digit
  if (country === "Portugal") {
    const dd = d.slice(0, 7);
    if (dd.length < 7) return dd;
    return `${dd.slice(0, 4)}-${dd.slice(4, 7)}`;
  }
  if (country === "Argentina") return d.slice(0, 4);
  if (country === "Chile") return d.slice(0, 7);
  return d;
}

function isZipComplete(country: string, raw: string) {
  const d = onlyDigits(raw);
  if (country === "Brasil") return d.length === 8;
  if (country === "United States") return d.length >= 5;
  if (country === "Portugal") return d.length === 7;
  if (country === "Argentina") return d.length >= 4;
  if (country === "Chile") return d.length === 7;
  return d.length >= 4;
}

/* ------------------------------------------------------------------ */
/* ICONS */
/* ------------------------------------------------------------------ */

function IconCheckCircleGreen(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      width="84"
      height="84"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M22 11.5V12a10 10 0 1 1-5.93-9.14"
        stroke="#22c55e"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M22 4 12 14.01l-3-3"
        stroke="#22c55e"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconXCircleRed(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      width="84"
      height="84"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M22 12a10 10 0 1 1-20 0a10 10 0 0 1 20 0Z"
        stroke="#ef4444"
        strokeWidth="2"
      />
      <path
        d="M8 8l8 8M16 8l-8 8"
        stroke="#ef4444"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconXCircleYellow(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      width="84"
      height="84"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M22 12a10 10 0 1 1-20 0a10 10 0 0 1 20 0Z"
        stroke="#efd544"
        strokeWidth="2"
      />
      <path
        d="M8 8l8 8M16 8l-8 8"
        stroke="#efd544"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconClose(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconLock(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7 10V8a5 5 0 0 1 10 0v2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M6.5 10h11A2.5 2.5 0 0 1 20 12.5v6A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-6A2.5 2.5 0 0 1 6.5 10Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M12 14v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconHeart(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 21s-7-4.6-9.4-9A5.7 5.7 0 0 1 12 5.7 5.7 5.7 0 0 1 21.4 12C19 16.4 12 21 12 21Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCopy(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9 9h10v10H9V9Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCard(props: { className?: string }) {
  return (
    <svg
      className={props.className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3.5 8.5h17"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M6.5 15.5h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M4.5 6h15A2.5 2.5 0 0 1 22 8.5v9A2.5 2.5 0 0 1 19.5 20h-15A2.5 2.5 0 0 1 2 17.5v-9A2.5 2.5 0 0 1 4.5 6Z"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function IconVerifiedBlue(props: { className?: string }) {
  return (
    <img
      className={props.className}
      width={15}
      height={15}
      alt="Verified"
      aria-hidden="true"
      src="https://static.vecteezy.com/system/resources/thumbnails/047/309/930/small/verified-badge-profile-icon-png.png"
    />
  );
}

function SpinnerMini() {
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
    </span>
  );
}

function SpinnerInInput() {
  return (
    <div className="h-[34px] w-[40px] rounded-lg border border-white/10 bg-white/[0.03] flex items-center justify-center shadow-[0_10px_35px_rgba(0,0,0,0.35)]">
      <SpinnerMini />
    </div>
  );
}

function PixImg(props: { className?: string }) {
  return (
    <img
      src={PIX_ICON_URL}
      alt="Pix"
      className={props.className}
      style={{ objectFit: "contain" }}
      draggable={false}
    />
  );
}

function BoletoImg(props: { className?: string }) {
  return (
    <img
      src={BOLETO_ICON_URL}
      alt="Boleto"
      className={props.className}
      style={{ objectFit: "contain" }}
      draggable={false}
    />
  );
}

function BrandMark({
  brand,
  cardDigits,
}: {
  brand: CardBrand;
  cardDigits: string;
}) {
  const show = onlyDigits(cardDigits).length >= 4;

  const src =
    brand === "visa"
      ? VISA_LOGO_URL
      : brand === "mastercard"
        ? MC_LOGO_URL
        : brand === "elo"
          ? ELO_LOGO_URL
          : brand === "amex"
            ? AMEX_LOGO_URL
            : null;

  return (
    <div className="flex items-center gap-2 mr-1.5">
      <span className="mr-1 h-5 w-px bg-white/10" />
      {show && src ? (
        <img
          src={src}
          alt={
            brand === "amex"
              ? "American Express"
              : brand[0].toUpperCase() + brand.slice(1)
          }
          className="h-[14px] w-auto opacity-90"
          draggable={false}
        />
      ) : (
        <span className="inline-flex items-center justify-center rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-white/60">
          CARD
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UI */
/* ------------------------------------------------------------------ */
function AnimatedError({ error }: { error?: unknown }) {
  const msg = safeText(error, "");

  return (
    <AnimatePresence initial={false}>
      {!!msg && (
        <motion.div
          key="err"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="mt-1.5 text-[11px] text-red-400/90"
        >
          {msg}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

type FieldProps = {
  label: string;
  placeholder?: string;
  right?: React.ReactNode;
  className?: string;
  value?: string;
  onChange?: (v: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  inputClassName?: string;
  insideLeft?: React.ReactNode;
  insideRight?: React.ReactNode;
  type?: string;
  error?: string | null;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  name?: string;
  maxLength?: number;
  readOnly?: boolean;
  shakeSignal?: number;
  hint?: string | null;
};

const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  {
    label,
    placeholder,
    right,
    className,
    value,
    onChange,
    onBlur,
    onFocus,
    inputClassName,
    insideLeft,
    insideRight,
    type,
    error,
    disabled,
    onKeyDown,
    autoComplete,
    inputMode,
    name,
    maxLength,
    readOnly,
    shakeSignal,
    hint,
  },
  ref,
) {
  const autoPadLeft = insideLeft ? "pl-[96px]" : "pl-4";
  const autoPadRight = insideRight ? "pr-16" : "pr-4";
  const [focused, setFocused] = useState(false);

  const [shakeTick, setShakeTick] = useState(0);
  const lastShakeRef = useRef<number>(0);

  useEffect(() => {
    if (!shakeSignal) return;
    if (!error) return;
    if (lastShakeRef.current === shakeSignal) return;
    lastShakeRef.current = shakeSignal;
    setShakeTick((s) => s + 1);
  }, [shakeSignal, error]);

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] text-white/55">{label}</span>
        {right}
      </div>

      <motion.div
        key={shakeTick}
        initial={{ x: 0 }}
        animate={error ? { x: [0, -7, 7, -5, 5, -3, 3, 0] } : { x: 0 }}
        transition={{ duration: 0.38, ease: "easeOut" }}
      >
        <div
          className={`group relative rounded-xl border bg-white/[0.03]
                   shadow-[0_12px_40px_rgba(0,0,0,0.55)]
                   ${error ? "border-red-500/60" : focused ? "border-[#214FC4]/50" : "border-white/10"}`}
        >
          <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/[0.07] to-transparent" />
          </div>

          {focused && !error && (
            <div className="pointer-events-none absolute -inset-[1px] rounded-xl opacity-60">
              <div className="absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_20%_20%,rgba(33,79,196,0.35),transparent_55%)]" />
            </div>
          )}

          {insideLeft && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              {insideLeft}
            </div>
          )}

          {insideRight && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
              {insideRight}
            </div>
          )}

          <input
            ref={ref}
            name={name}
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            onFocus={() => {
              setFocused(true);
              onFocus?.();
            }}
            onBlur={() => {
              setFocused(false);
              onBlur?.();
            }}
            onKeyDown={onKeyDown}
            type={type}
            placeholder={placeholder}
            disabled={disabled}
            readOnly={readOnly}
            autoComplete={autoComplete}
            inputMode={inputMode}
            maxLength={maxLength}
            aria-invalid={!!error}
            className={`relative w-full bg-transparent py-2.5 text-[13px] text-white/90
                     placeholder:text-white/30 outline-none disabled:opacity-60
                     ${readOnly ? "opacity-80" : ""}
                     ${autoPadLeft} ${autoPadRight} ${inputClassName || ""}`}
          />
        </div>
      </motion.div>

      {!!hint && !error && (
        <div className="mt-1.5 text-[11px] text-white/35">{hint}</div>
      )}
      <AnimatedError error={error} />
    </div>
  );
});

function Select({
  label,
  value,
  options,
  onChange,
  right,
  className,
  maxMenuHeight = 220,
  maxMenuWidth = 420,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  right?: React.ReactNode;
  className?: string;
  maxMenuHeight?: number;
  maxMenuWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [pos, setPos] = useState<{
    left: number;
    top?: number;
    bottom?: number;
    width: number;
    openUp: boolean;
    maxHeight: number;
  } | null>(null);

  function computePos() {
    const btn = btnRef.current;
    if (!btn) return;

    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const width = Math.min(r.width, maxMenuWidth);
    const left = Math.min(
      Math.max(12, r.left + (r.width - width)),
      vw - width - 12,
    );

    const spaceBelow = vh - r.bottom - 12;
    const spaceAbove = r.top - 12;
    const openUp =
      spaceBelow < Math.min(maxMenuHeight, 220) && spaceAbove > spaceBelow;

    const maxHeight = Math.max(
      140,
      Math.min(maxMenuHeight, openUp ? spaceAbove - 12 : spaceBelow - 12),
    );

    setPos({
      left,
      width,
      openUp,
      maxHeight,
      top: openUp ? undefined : r.bottom + 8,
      bottom: openUp ? vh - r.top + 8 : undefined,
    });
  }

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    computePos();

    const onMove = () => computePos();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);

    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const menu =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence>
            <motion.div
              ref={menuRef}
              initial={{ opacity: 0, y: pos.openUp ? -8 : 8, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: pos.openUp ? -8 : 8, scale: 0.99 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              style={{
                position: "fixed",
                left: pos.left,
                top: pos.top,
                bottom: pos.bottom,
                width: pos.width,
                zIndex: 10050,
              }}
              className="overflow-hidden rounded-2xl border border-white/10 bg-black/70 backdrop-blur-2xl
                       shadow-[0_28px_80px_rgba(0,0,0,0.70)]"
            >
              <div
                className="wc-scroll overflow-y-auto p-2"
                style={{ maxHeight: pos.maxHeight }}
              >
                {options.map((opt) => {
                  const active = opt === value;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        onChange(opt);
                        setOpen(false);
                      }}
                      className={`w-full rounded-xl px-3 py-2.5 text-left text-[13px] transition
                      ${
                        active
                          ? "bg-[#214FC4]/20 text-white border border-[#214FC4]/30"
                          : "text-white/70 hover:text-white hover:bg-white/[0.05] border border-transparent"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate">{opt}</span>
                        {active && (
                          <span className="text-[#2B67FF] text-[12px] font-semibold">
                            Selecionado
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <>
      <div className={`relative ${className || ""}`} ref={wrapRef}>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[12px] text-white/55">{label}</span>
          {right}
        </div>

        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((s) => !s)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen((s) => !s);
            }
          }}
          className="group relative w-full rounded-xl border border-white/10 bg-white/[0.03]
                   px-4 py-2.5 text-[13px] text-white/90 text-left
                   shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-center justify-between">
            <span className="truncate">{value}</span>
            <span
              className={`text-white/35 transition ${open ? "rotate-180" : ""}`}
            >
              ▾
            </span>
          </div>

          <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition pointer-events-none">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-b from-white/[0.07] to-transparent" />
          </div>
        </button>
      </div>
      {menu}
    </>
  );
}

function DividerRow({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between text-[13px]">
      <span className="text-white/55">{left}</span>
      <span className="text-white/80">{right}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MAIN */
/* ------------------------------------------------------------------ */

type LiveStatus =
  | "idle"
  | "pending"
  | "approved"
  | "cancelled"
  | "expired"
  | "rejected";

type Method = "card" | "pix" | "boleto";
type PixStep = "form" | "qr" | "success";

export default function Pay({
  open,
  onClose,
  plan,
  billing,
  planTitle,
  planDescription,
}: PayProps) {
  const reduceMotion = useReducedMotion();

  const safePlan = useMemo(() => normalizePlan(plan), [plan]);
  const safeBilling = useMemo(() => normalizeBilling(billing), [billing]);

  const safePlanTitle = useMemo(
    () => safeText(planTitle, "Plano"),
    [planTitle],
  );

  const safePlanDescription = useMemo(
    () => safeText(planDescription, ""),
    [planDescription],
  );

  const [method, setMethod] = useState<Method>("card");

  const COUNTRIES = useMemo<CountryKey[]>(
    () => ["Brasil", "United States", "Portugal", "Argentina", "Chile"],
    [],
  );

  const BRAZIL_STATES = useMemo(
    () => [
      "Acre",
      "Alagoas",
      "Amapá",
      "Amazonas",
      "Bahia",
      "Ceará",
      "Distrito Federal",
      "Espírito Santo",
      "Goiás",
      "Maranhão",
      "Mato Grosso",
      "Mato Grosso do Sul",
      "Minas Gerais",
      "Pará",
      "Paraíba",
      "Paraná",
      "Pernambuco",
      "Piauí",
      "Rio de Janeiro",
      "Rio Grande do Norte",
      "Rio Grande do Sul",
      "Rondônia",
      "Roraima",
      "Santa Catarina",
      "São Paulo",
      "Sergipe",
      "Tocantins",
    ],
    [],
  );

  const US_STATES = useMemo(
    () => [
      "Alabama",
      "Alaska",
      "Arizona",
      "Arkansas",
      "California",
      "Colorado",
      "Connecticut",
      "Delaware",
      "Florida",
      "Georgia",
      "Hawaii",
      "Idaho",
      "Illinois",
      "Indiana",
      "Iowa",
      "Kansas",
      "Kentucky",
      "Louisiana",
      "Maine",
      "Maryland",
      "Massachusetts",
      "Michigan",
      "Minnesota",
      "Mississippi",
      "Missouri",
      "Montana",
      "Nebraska",
      "Nevada",
      "New Hampshire",
      "New Jersey",
      "New Mexico",
      "New York",
      "North Carolina",
      "North Dakota",
      "Ohio",
      "Oklahoma",
      "Oregon",
      "Pennsylvania",
      "Rhode Island",
      "South Carolina",
      "South Dakota",
      "Tennessee",
      "Texas",
      "Utah",
      "Vermont",
      "Virginia",
      "Washington",
      "West Virginia",
      "Wisconsin",
      "Wyoming",
      "District of Columbia",
    ],
    [],
  );

  const US_ABBR_TO_STATE = useMemo<Record<string, string>>(
    () => ({
      AL: "Alabama",
      AK: "Alaska",
      AZ: "Arizona",
      AR: "Arkansas",
      CA: "California",
      CO: "Colorado",
      CT: "Connecticut",
      DE: "Delaware",
      FL: "Florida",
      GA: "Georgia",
      HI: "Hawaii",
      ID: "Idaho",
      IL: "Illinois",
      IN: "Indiana",
      IA: "Iowa",
      KS: "Kansas",
      KY: "Kentucky",
      LA: "Louisiana",
      ME: "Maine",
      MD: "Maryland",
      MA: "Massachusetts",
      MI: "Michigan",
      MN: "Minnesota",
      MS: "Mississippi",
      MO: "Missouri",
      MT: "Montana",
      NE: "Nebraska",
      NV: "Nevada",
      NH: "New Hampshire",
      NJ: "New Jersey",
      NM: "New Mexico",
      NY: "New York",
      NC: "North Carolina",
      ND: "North Dakota",
      OH: "Ohio",
      OK: "Oklahoma",
      OR: "Oregon",
      PA: "Pennsylvania",
      RI: "Rhode Island",
      SC: "South Carolina",
      SD: "South Dakota",
      TN: "Tennessee",
      TX: "Texas",
      UT: "Utah",
      VT: "Vermont",
      VA: "Virginia",
      WA: "Washington",
      WV: "West Virginia",
      WI: "Wisconsin",
      WY: "Wyoming",
      DC: "District of Columbia",
    }),
    [],
  );

  const PT_DISTRICTS = useMemo(
    () => [
      "Aveiro",
      "Beja",
      "Braga",
      "Bragança",
      "Castelo Branco",
      "Coimbra",
      "Évora",
      "Faro",
      "Guarda",
      "Leiria",
      "Lisboa",
      "Portalegre",
      "Porto",
      "Santarém",
      "Setúbal",
      "Viana do Castelo",
      "Vila Real",
      "Viseu",
      "Açores",
      "Madeira",
    ],
    [],
  );

  const AR_PROVINCES = useMemo(
    () => [
      "Buenos Aires",
      "Ciudad Autónoma de Buenos Aires",
      "Catamarca",
      "Chaco",
      "Chubut",
      "Córdoba",
      "Corrientes",
      "Entre Ríos",
      "Formosa",
      "Jujuy",
      "La Pampa",
      "La Rioja",
      "Mendoza",
      "Misiones",
      "Neuquén",
      "Río Negro",
      "Salta",
      "San Juan",
      "San Luis",
      "Santa Cruz",
      "Santa Fe",
      "Santiago del Estero",
      "Tierra del Fuego",
      "Tucumán",
    ],
    [],
  );

  const CL_REGIONS = useMemo(
    () => [
      "Arica y Parinacota",
      "Tarapacá",
      "Antofagasta",
      "Atacama",
      "Coquimbo",
      "Valparaíso",
      "Región Metropolitana de Santiago",
      "Libertador General Bernardo O'Higgins",
      "Maule",
      "Ñuble",
      "Biobío",
      "La Araucanía",
      "Los Ríos",
      "Los Lagos",
      "Aysén del General Carlos Ibáñez del Campo",
      "Magallanes y de la Antártica Chilena",
    ],
    [],
  );

  const UF_TO_STATE = useMemo<Record<string, string>>(
    () => ({
      AC: "Acre",
      AL: "Alagoas",
      AP: "Amapá",
      AM: "Amazonas",
      BA: "Bahia",
      CE: "Ceará",
      DF: "Distrito Federal",
      ES: "Espírito Santo",
      GO: "Goiás",
      MA: "Maranhão",
      MT: "Mato Grosso",
      MS: "Mato Grosso do Sul",
      MG: "Minas Gerais",
      PA: "Pará",
      PB: "Paraíba",
      PR: "Paraná",
      PE: "Pernambuco",
      PI: "Piauí",
      RJ: "Rio de Janeiro",
      RN: "Rio Grande do Norte",
      RS: "Rio Grande do Sul",
      RO: "Rondônia",
      RR: "Roraima",
      SC: "Santa Catarina",
      SP: "São Paulo",
      SE: "Sergipe",
      TO: "Tocantins",
    }),
    [],
  );

  const [country, setCountry] = useState<CountryKey>("Brasil");

  const REGIONS = useMemo(() => {
    if (country === "Brasil") return BRAZIL_STATES;
    if (country === "United States") return US_STATES;
    if (country === "Portugal") return PT_DISTRICTS;
    if (country === "Argentina") return AR_PROVINCES;
    if (country === "Chile") return CL_REGIONS;
    return BRAZIL_STATES;
  }, [
    AR_PROVINCES,
    BRAZIL_STATES,
    CL_REGIONS,
    PT_DISTRICTS,
    US_STATES,
    country,
  ]);

  const [stateUF, setStateUF] = useState("São Paulo");
  const [city, setCity] = useState("São Paulo");
  const [zip, setZip] = useState("");
  const [address, setAddress] = useState("");
  const [cpf, setCpf] = useState("");

  const [uiGate, setUiGate] = useState<"idle" | "loading" | "ready">("idle");
  const uiGateTimerRef = useRef<number | null>(null);

  const [zipError, setZipError] = useState<string | null>(null);
const [addressError, setAddressError] = useState<string | null>(null);
const [cityError, setCityError] = useState<string | null>(null);

// se você já tem zipRef e addressRef, ok. Se não tiver:
const zipRef = useRef<HTMLInputElement | null>(null);
const addressRef = useRef<HTMLInputElement | null>(null);
const cityRef = useRef<HTMLInputElement | null>(null);

  const [zipLoading, setZipLoading] = useState(false);
  const [cityLocked, setCityLocked] = useState(false);
  const [stateAutoHint, setStateAutoHint] = useState<string | null>(null);
  const zipAbortRef = useRef<AbortController | null>(null);
  const zipDebounceRef = useRef<number | null>(null);
  const cardEmailTouchedRef = useRef(false);

  // Inteligência: cache + dedupe de lookup postal
  const zipCacheRef = useRef<Map<string, any>>(new Map());
  const lastLookupKeyRef = useRef<string>("");

  // Discord (email vem do cookie)
  const [discordEmail, setDiscordEmail] = useState<string>("");
  const [discordId, setDiscordId] = useState<string>(""); // ✅ novo

  // PIX: dados que o usuário digita
  const [pixName, setPixName] = useState<string>("");
  const [pixCpf, setPixCpf] = useState<string>("");

  // validação do Pix
  const [pixErrors, setPixErrors] = useState<{
    name?: string | null;
    cpf?: string | null;
    email?: string | null;
  }>({});

  // refs do Pix (pra foco)

  // CARD FIELDS + VALIDATION
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  const [cardCpfError, setCardCpfError] = useState<string | null>(null);
  const [pixCpfError, setPixCpfError] = useState<string | null>(null);

  const [cardNumber, setCardNumber] = useState("");
  const [exp, setExp] = useState("");
  const [cvc, setCvc] = useState("");
  const [holderName, setHolderName] = useState("");
  const [holderNameError, setHolderNameError] = useState<string | null>(null);

  const [cardErrors, setCardErrors] = useState<{
    cardNumber?: string | null;
    exp?: string | null;
    cvc?: string | null;
  }>({});

  const cardDigits = useMemo(() => onlyDigits(cardNumber), [cardNumber]);
  const brand = useMemo(() => detectBrand(cardDigits), [cardDigits]);

  const [boletoStep, setBoletoStep] = useState<"form" | "generated">("form");
  const [boletoSentToEmail, setBoletoSentToEmail] = useState<string>("");
  const [boletoName, setBoletoName] = useState("");
  const [boletoCpf, setBoletoCpf] = useState("");

  const [boletoEmail, setBoletoEmail] = useState("");

  const [boletoZip, setBoletoZip] = useState("");
  const [boletoStreetName, setBoletoStreetName] = useState("");
  const [boletoStreetNumber, setBoletoStreetNumber] = useState("");
  const [boletoNeighborhood, setBoletoNeighborhood] = useState("");
  const [boletoCity, setBoletoCity] = useState("");
  const [boletoUF, setBoletoUF] = useState("SP");

  const [boletoCepLoading, setBoletoCepLoading] = useState(false);

  const [liveStatus, setLiveStatus] = useState<FinalStatus | null>(null);
  const [liveStatusDetail, setLiveStatusDetail] = useState<string | null>(null);

  const [pixStep, setPixStep] = useState<PixStep>("form"); // ou seu default real

  const [boletoErrors, setBoletoErrors] = useState<{
    email?: string | null;
    name?: string | null;
    cpf?: string | null;
    zip?: string | null;
    street_name?: string | null;
    street_number?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    federal_unit?: string | null;
  }>({});

  const boletoEmailRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const du = await readDiscordUserSafe();
      const mail = String(du?.email || "").trim();
      const did = String(du?.id || "").trim(); // ✅ novo

      setDiscordEmail(mail);
      setDiscordId(did); // ✅ novo

      if (cancelled) return;

      setDiscordEmail(mail);

      // ✅ deixa boleto acompanhar o Pix (mas sem sobrescrever se o user já digitou)
      setBoletoEmail((prev: string) => (prev?.trim() ? prev : mail || ""));

      // ✅ sentTo usa o que existir (sem depender de state stale)
      setBoletoSentToEmail((prev: string) =>
        prev?.trim() ? prev : mail || "",
      );
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // CUPOM
  const [couponMode, setCouponMode] = useState<
    "closed" | "editing" | "applied"
  >("closed");
  const [coupon, setCoupon] = useState("");
  const [couponValidating, setCouponValidating] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const couponRef = useRef<HTMLInputElement | null>(null);
  const couponBoxRef = useRef<HTMLDivElement | null>(null);
  const couponInteractedRef = useRef(false);

  const lastAppliedRef = useRef<string>("");

  // PIX ( agora real)
  const [pixCopied, setPixCopied] = useState(false);
  const [pixQrBase64, setPixQrBase64] = useState<string | null>(null);
  const [pixCopyPaste, setPixCopyPaste] = useState<string>("");
  const [pixPaymentId, setPixPaymentId] = useState<string | null>(null);

  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderRevision, setOrderRevision] = useState<number>(0);

  const [pixCopyPulse, setPixCopyPulse] = useState(0);

  const [pixNameError, setPixNameError] = useState<string | null>(null);

  const pixNameRef = useRef<HTMLInputElement | null>(null);
  const pixCpfRef = useRef<HTMLInputElement | null>(null);

  const pixCode = pixCopyPaste || "";

  // BOLETO ( agora real)
  const [boletoTicketUrl, setBoletoTicketUrl] = useState<string | null>(null);
  const [boletoPaymentId, setBoletoPaymentId] = useState<string | null>(null);
  const [boletoBarcode, setBoletoBarcode] = useState<string | null>(null);

  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const isFinalStatus = (s: string | null | undefined) =>
    s === "approved" ||
    s === "rejected" ||
    s === "cancelled" ||
    s === "expired";

  const startPollingPayment = useCallback(
    (paymentId: string, kind: "pix" | "boleto") => {
      stopPolling();
setLiveStatus(null);
      setLiveStatusDetail(null);

      pollRef.current = window.setInterval(async () => {
        try {
          const r = await fetch(
            `/api/pagment?id=${encodeURIComponent(paymentId)}`,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              credentials: "include",
              cache: "no-store",
            },
          );

          // ✅ se a API negar (sessão/cookie não foi junto), para polling e mostra motivo
          if (r.status === 401 || r.status === 403) {
            stopPolling();
            setLiveStatusDetail(
              "Sessão expirada ou sem permissão. Faça login novamente e gere o pagamento de novo.",
            );
            return;
          }

          const j = await r.json().catch(() => null);
          if (!r.ok || !j?.ok) return;

          const status = String(j.status || "");
          const detail = j.status_detail ? String(j.status_detail) : null;

          setLiveStatus((status as any) || "pending");
          setLiveStatusDetail(detail);

          const nextQrB64 = safeStringOrNull(j.qr_code_base64);
          const nextQr = safeStringOrNull(j.qr_code);
          const nextTicket = safeStringOrNull(j.ticket_url);
          const nextBarcode = safeStringOrNull(j.barcode);

          if (kind === "pix") {
            if (nextQrB64) setPixQrBase64((prev) => prev || nextQrB64);
            if (nextQr) setPixCopyPaste((prev) => (prev ? prev : nextQr));
          } else {
            if (nextTicket) setBoletoTicketUrl((prev) => prev || nextTicket);
            if (nextBarcode) setBoletoBarcode((prev) => prev || nextBarcode);
          }

          if (isFinalStatus(status)) {
            stopPolling();

            if (status === "approved") {
              setActionState("success");

              if (kind === "pix") {
                setPixStep("success");
                setPixCopied(false);
                setPixQrBase64(null);
                setPixCopyPaste("");
              }
            }
          }
        } catch {}
      }, 3000);
    },
    [stopPolling, isFinalStatus],
  );

  useEffect(() => {
    if (!open) return;

    const mail = String(discordEmail || "").trim();
    if (!mail) return;

    // ✅ só preenche se usuário não mexeu e o campo está vazio
    setEmail((prev) => {
      const cur = String(prev || "").trim();
      if (cardEmailTouchedRef.current) return prev;
      return cur ? prev : mail;
    });

    // ✅ não deixa erro “fantasma” quando preenche
    setEmailError(null);
  }, [open, discordEmail]);

  // FOOTER MEASURE (para não cobrir inputs)
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [footerH, setFooterH] = useState<number>(220);

  // Refs para inteligência de foco / auto-avanço
  const emailRef = useRef<HTMLInputElement | null>(null);
  const cardNumberRef = useRef<HTMLInputElement | null>(null);
  const expRef = useRef<HTMLInputElement | null>(null);
  const cvcRef = useRef<HTMLInputElement | null>(null);
  const holderNameRef = useRef<HTMLInputElement | null>(null);
  const cpfRef = useRef<HTMLInputElement | null>(null);

  const boletoNameRef = useRef<HTMLInputElement | null>(null);
  const boletoCpfRef = useRef<HTMLInputElement | null>(null);

  // Inteligência visual: progress + shake signal
  const [shakeSignal, setShakeSignal] = useState(0);

  // Estado do botão primário (loading/success)
  const [actionState, setActionState] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const actionTimerRef = useRef<number | null>(null);

  type DevAction = "approve" | "reject" | "expire";
  type DevStatus = "approved" | "rejected" | "expired";

  const [devAllowed, setDevAllowed] = useState(false);
  const [devMenuOpen, setDevMenuOpen] = useState(false);
  const [devActionLoading, setDevActionLoading] = useState<DevAction | null>(
    null,
  );
  const [devError, setDevError] = useState<string | null>(null);

  function devActionToStatus(a: DevAction): DevStatus {
    if (a === "approve") return "approved";
    if (a === "reject") return "rejected";
    return "expired";
  }

  // ✅ Checa permissão no server (cookie -> supabase dev_permission)
  useEffect(() => {
    if (!open) return;

    let alive = true;

    (async () => {
      try {
        const r = await fetch("/api/pagment/dev", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        const j = await r.json().catch(() => null);
        if (!alive) return;

        setDevAllowed(!!j?.allowed);
      } catch {
        if (!alive) return;
        setDevAllowed(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [open]);

  // ✅ fecha menu ao clicar fora / ESC
  const devWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!devMenuOpen) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (devWrapRef.current?.contains(t)) return;
      setDevMenuOpen(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDevMenuOpen(false);
    };

    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);

    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [devMenuOpen]);

  function applyDevStatus(status: DevStatus, detail?: string | null) {
    stopPolling();

    setLiveStatus(status as any);
    setLiveStatusDetail(detail || `DEV override: ${status}`);

    // feedback visual no botão principal
    if (status === "approved") {
      setActionState("success");
      if (actionTimerRef.current) window.clearTimeout(actionTimerRef.current);
      actionTimerRef.current = window.setTimeout(
        () => setActionState("idle"),
        900,
      );
    } else {
      setActionState("error");
      if (actionTimerRef.current) window.clearTimeout(actionTimerRef.current);
      actionTimerRef.current = window.setTimeout(
        () => setActionState("idle"),
        900,
      );
    }

    // PIX: simula como se tivesse mudado o status real
    if (method === "pix") {
      if (status === "approved") {
        setPixStep("success");
        setPixCopied(false);
        setPixQrBase64(null);
        setPixCopyPaste("");
        return;
      }

      // falha: força a tela de erro (que você já tem para expired/rejected)
      setPixStep("qr");
      return;
    }

    // BOLETO: mantém step; liveStatus serve pra você exibir badge/mensagem se quiser
    if (method === "boleto") {
      // opcional: se quiser, pode manter o boletoStep como está.
      // aqui não mexo no boletoStep pra não quebrar seu fluxo atual.
      return;
    }

    // CARD: se você tiver UI de card, use liveStatus também
  }

  async function runDevAction(action: DevAction) {
    setDevError(null);
    setDevActionLoading(action);

    try {
      const r = await fetch("/api/pagment/dev", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action,
          kind: method, // opcional (pix|boleto|card) - só pra log/retorno
        }),
      });

      const j = await r.json().catch(() => null);

      if (!r.ok || !j?.ok) {
        throw new Error(j?.message || "Falha ao executar DEV action.");
      }

      const status = String(j.status || devActionToStatus(action)) as DevStatus;
      const detail = j.status_detail ? String(j.status_detail) : null;

      applyDevStatus(status, detail);
      setDevMenuOpen(false);
    } catch (e: any) {
      setDevError(String(e?.message || "Erro DEV."));
    } finally {
      setDevActionLoading(null);
    }
  }

  // Modal focus trap
  const modalCardRef = useRef<HTMLDivElement | null>(null);

  const clearActionTimer = useCallback(() => {
    if (actionTimerRef.current) window.clearTimeout(actionTimerRef.current);
    actionTimerRef.current = null;
  }, []);

  useLayoutEffect(() => {
    const el = footerRef.current;
    if (!el) return;

    const update = () => setFooterH(el.getBoundingClientRect().height);

    update();

    if (typeof ResizeObserver === "undefined") {
      const t = window.setInterval(update, 400);
      return () => window.clearInterval(t);
    }

    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    // lock body scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        // submit inteligente (Ctrl+Enter)
        handlePrimaryAction();
      }
    };
    window.addEventListener("keydown", onKey);

    // focus trap
    const onTrap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = modalCardRef.current;
      if (!root) return;

      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (el) =>
          !el.hasAttribute("disabled") &&
          !el.getAttribute("aria-hidden") &&
          el.tabIndex !== -1,
      );

      if (!focusables.length) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      const active = document.activeElement as HTMLElement | null;
      if (!active) return;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onTrap, true);

    const t = window.setTimeout(() => {
      emailRef.current?.focus();
    }, 60);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onTrap, true);
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setUiGate("idle");
      if (uiGateTimerRef.current) window.clearTimeout(uiGateTimerRef.current);
      uiGateTimerRef.current = null;
      return;
    }

    setUiGate("loading");
    if (uiGateTimerRef.current) window.clearTimeout(uiGateTimerRef.current);

    uiGateTimerRef.current = window.setTimeout(() => {
      setUiGate("ready");
    }, 2000);

    return () => {
      if (uiGateTimerRef.current) window.clearTimeout(uiGateTimerRef.current);
      uiGateTimerRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    let alive = true;

    const loadDiscordEmailFromSupabase = async () => {
      try {
        const res = await fetch("/api/me", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });

        const data = await res.json().catch(() => null);
        const mail = String(data?.user?.email || "").trim();

        if (!alive) return;

        setDiscordEmail(mail);

        // ✅ CARD: pré-preenche, mas usuário pode apagar/trocar
        if (mail && !String(email || "").trim()) {
          setEmail(mail);
        }

        // ✅ BOLETO: pré-preenche, mas usuário pode apagar/trocar
        if (mail && !String(boletoEmail || "").trim()) {
          setBoletoEmail(mail);
        }
      } catch {
        // não quebra UI
      }
    };

    loadDiscordEmailFromSupabase();

    return () => {
      alive = false;
    };
    // ⚠️ intencional: roda 1x ao abrir o Pay
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (open) {
      setPixStep("form");
      setPixName("");
      setPixCpf("");
      setPixNameError(null);

      clearActionTimer();
      setActionState("idle");

      setMethod("card");

      setCoupon("");
      setCouponError(null);
      setCouponValidating(false);
      lastAppliedRef.current = "";

      setCountry("Brasil");
      setStateUF("São Paulo");
      setCity("São Paulo");
      setZip("");
      setAddress("");
      setCpf("");
      setZipLoading(false);
      setZipError(null);
      setCityLocked(false);
      setStateAutoHint(null);


      cardEmailTouchedRef.current = false; // ✅ reset do “tocou no campo” ao abrir

      const mail = String(discordEmail || "").trim();
      setEmail(mail || "");

      setEmailError(null);
      setCardCpfError(null);
      setPixCpfError(null);

      setCardNumber("");
      setExp("");
      setCvc("");
      setHolderName("");
      setCardErrors({});

      setBoletoName("");
      setBoletoCpf("");
      setBoletoStep("form");
      setBoletoSentToEmail("");
      setBoletoZip("");
      setBoletoStreetName("");
      setBoletoStreetNumber("");
      setBoletoNeighborhood("");
      setBoletoCity("");
      setBoletoUF("SP");
      setBoletoCepLoading(false);

      setBoletoErrors({});

      setPixCopied(false);

      setPixQrBase64(null);
      setPixCopyPaste("");
      setPixPaymentId(null);

      setBoletoTicketUrl(null);
      setBoletoPaymentId(null);
      setBoletoBarcode(null);

 
      setLiveStatusDetail(null);

      setPixErrors({});
      stopPolling();

      zipAbortRef.current?.abort();
      lastLookupKeyRef.current = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (couponMode === "editing") {
      const t = setTimeout(() => {
        couponRef.current?.focus();
        couponRef.current?.select();
      }, 20);
      return () => clearTimeout(t);
    }
  }, [couponMode]);

  useEffect(() => {
    if (couponMode !== "editing") return;

    const onDown = (e: MouseEvent) => {
      // ✅ se o usuário NÃO chegou a clicar/teclar no input do cupom
      if (couponInteractedRef.current) return;

      const t = e.target as Node;
      if (couponBoxRef.current?.contains(t)) return;

      // ✅ clicou fora sem interagir com o input => volta pro botão Add code
      setCouponError(null);
      setCouponValidating(false);
      setCouponMode("closed");
    };

    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [couponMode]);

  type AppliedCouponMeta = {
    code: string;
    source: "coupon" | "gift_coupon";
    discount: {
      kind: "percent" | "amount" | "target_total";
      percent: number | null;
      amount_cents: number | null;
      target_total_cents: number | null;
    };
  };

  const [appliedCouponMeta, setAppliedCouponMeta] =
    useState<AppliedCouponMeta | null>(null);

  // Ajusta defaults quando muda país (evita inconsistências visuais / select inválido)
  useEffect(() => {
    if (!open) return;

    setZip("");
    setAddress("");
    setZipError(null);
    setZipLoading(false);
    setCityLocked(false);
    setStateAutoHint(null);

    if (country === "Brasil") {
      setStateUF("São Paulo");
      setCity("São Paulo");
      return;
    }
    if (country === "United States") {
      setStateUF("California");
      setCity("");
      return;
    }
    if (country === "Portugal") {
      setStateUF("Lisboa");
      setCity("");
      return;
    }
    if (country === "Argentina") {
      setStateUF("Buenos Aires");
      setCity("");
      return;
    }
    if (country === "Chile") {
      setStateUF("Región Metropolitana de Santiago");
      setCity("");
      return;
    }
  }, [country, open]);

  const order = useMemo(() => {
    const unit = PLAN_PRICES[safeBilling]?.[safePlan] ?? 0;
    const multiplier = safeBilling === "annual" ? 12 : 1;

    const subtotalCents = toCents(unit) * multiplier;
    const taxCents = toCents(0.0);

    const baseTotalCents = subtotalCents + taxCents;

    const appliedCode = coupon.trim().toUpperCase();

    const hasApplied =
      couponMode === "applied" &&
      !!appliedCouponMeta &&
      appliedCouponMeta.code === appliedCode;

    let discountCents = 0;
    let totalCents = baseTotalCents;
    let discountLabel: string | null = null;

    if (hasApplied) {
      const d = appliedCouponMeta.discount;

      if (d.kind === "percent") {
        const pct = Math.max(0, Math.min(100, Number(d.percent || 0)));
        discountCents = Math.round((baseTotalCents * pct) / 100);
      } else if (d.kind === "amount") {
        discountCents = Math.max(0, Number(d.amount_cents || 0));
      } else if (d.kind === "target_total") {
        const target = Math.max(0, Number(d.target_total_cents || 0));
        discountCents = Math.max(0, baseTotalCents - target);
      }

      discountCents = Math.min(discountCents, baseTotalCents);
      totalCents = Math.max(0, baseTotalCents - discountCents);
      discountLabel = `Cupom (${appliedCode})`;
    }

    return {
      subtotal: centsToNumber(subtotalCents),
      tax: centsToNumber(taxCents),
      discount: centsToNumber(discountCents),
      discountLabel,
      total: centsToNumber(totalCents),
    };
  }, [billing, plan, couponMode, coupon]);

  const billingLabel = safeBilling === "annual" ? "Anual" : "Mensal";
  const billingNote =
    safeBilling === "annual" ? "Cobrança anual" : "Cobrança mensal";

  const pixFailed =
    method === "pix" &&
    pixStep === "qr" &&
    (liveStatus === "cancelled" ||
      liveStatus === "expired" ||
      liveStatus === "rejected");

  const pixPaid =
    method === "pix" && (pixStep === "success" || liveStatus === "approved");

  const pixAwaiting =
    method === "pix" && pixStep === "qr" && !pixFailed && !pixPaid;

  const basePrimaryBtnLabel =
    method === "card"
      ? `Pagar ${formatBRL(order.total)}`
      : method === "pix"
        ? pixPaid
          ? "Pagamento Efetuado"
          : pixFailed
            ? "Tentar novamente"
            : pixStep === "qr"
              ? "Aguardando Pagamento"
              : "Continuar"
        : boletoStep === "generated"
          ? "Boleto gerado"
          : "Enviar Boleto";

const isFailed =
  liveStatus === "expired" ||
  liveStatus === "rejected" ||
  liveStatus === "cancelled";

const showRetryCta = isFailed;

const primaryBtnDisabled =
  actionState === "loading" ||
  (!showRetryCta && method === "pix" && (pixAwaiting || pixPaid)) ||
  (!showRetryCta && method === "boleto" && boletoStep === "generated");

  // ✅ Pix não deve mostrar "Pix gerado" — sempre "Aguardando Pagamento" quando tiver QR.
  const primaryBtnLabel =
    method === "pix"
      ? actionState === "loading"
        ? " " // processando...
        : pixPaid
          ? "Pagamento Efetuado"
          : pixFailed
            ? "Tentar novamente"
            : pixStep === "qr"
              ? "Aguardando Pagamento"
              : "Continuar"
      : actionState === "loading"
        ? " " // processando...
        : actionState === "success"
          ? method === "card"
            ? "Pagamento confirmado"
            : "Boleto enviado"
          : basePrimaryBtnLabel;

  // Validação inteligente “live” (leve + não intrusiva)
  const emailLiveTimer = useRef<number | null>(null);
  const cpfLiveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (!email.trim()) return;

    if (emailLiveTimer.current) window.clearTimeout(emailLiveTimer.current);
    emailLiveTimer.current = window.setTimeout(() => {
      if (emailError) setEmailError(validateEmailField(email));
    }, 420);

    return () => {
      if (emailLiveTimer.current) window.clearTimeout(emailLiveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  useEffect(() => {
    if (!open) return;
    if (!cpf.trim()) return;

    if (cpfLiveTimer.current) window.clearTimeout(cpfLiveTimer.current);
    cpfLiveTimer.current = window.setTimeout(() => {
      if (cardCpfError) setCardCpfError(validateCpfField(cpf));
    }, 420);

    return () => {
      if (cpfLiveTimer.current) window.clearTimeout(cpfLiveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpf, open, cardCpfError]);

  async function lookupBoletoCep(rawCep: string) {
    const d = onlyDigits(rawCep).slice(0, 8);
    if (d.length !== 8) return;

    setBoletoCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const data = (await res.json()) as any;

      if (!res.ok || data?.erro) {
        setBoletoErrors((s) => ({
          ...s,
          zip: "CEP inválido ou não encontrado.",
        }));
        return;
      }

      setBoletoErrors((s) => ({ ...s, zip: null }));

      if (data?.logradouro) setBoletoStreetName(String(data.logradouro));
      if (data?.bairro) setBoletoNeighborhood(String(data.bairro));
      if (data?.localidade) setBoletoCity(String(data.localidade));

      const uf = String(data?.uf || "").toUpperCase();
      if (uf && UF_CODES.includes(uf)) setBoletoUF(uf);
    } catch {
      setBoletoErrors((s) => ({
        ...s,
        zip: "Falha ao buscar CEP. Tente novamente.",
      }));
    } finally {
      setBoletoCepLoading(false);
    }
  }

  async function lookupPostal(rawZip: string, selectedCountry: CountryKey) {
    const cleaned = normalizeZipForLookup(selectedCountry, rawZip);

    if (!isZipComplete(selectedCountry, rawZip)) return;

    const cacheKey = `${selectedCountry}:${cleaned}`;
    if (lastLookupKeyRef.current === cacheKey && cityLocked) return;
    lastLookupKeyRef.current = cacheKey;

    // cache hit
    const cached = zipCacheRef.current.get(cacheKey);
    if (cached) {
      setZipError(null);
      setZipLoading(false);
      setStateAutoHint(cached.stateAutoHint || null);

      if (typeof cached.address === "string" && cached.address)
        setAddress(cached.address);
      if (typeof cached.city === "string" && cached.city) setCity(cached.city);
      if (typeof cached.stateUF === "string" && cached.stateUF)
        setStateUF(cached.stateUF);

      setCityLocked(true);
      return;
    }

    try {
      zipAbortRef.current?.abort();
      const controller = new AbortController();
      zipAbortRef.current = controller;

      setZipLoading(true);
      setZipError(null);
      setStateAutoHint(null);

      // BR: ViaCEP (rua/bairro/cidade/uf)
      if (selectedCountry === "Brasil") {
        const d = onlyDigits(cleaned).slice(0, 8);
        const res = await fetch(`https://viacep.com.br/ws/${d}/json/`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as any;

        if (!res.ok || data?.erro) {
          setZipError("CEP inválido ou não encontrado.");
          setZipLoading(false);
          setCityLocked(false);
          return;
        }

        const st = UF_TO_STATE[String(data.uf || "").toUpperCase()] || stateUF;
        const addr = [data.logradouro, data.bairro].filter(Boolean).join(", ");

        if (addr) setAddress(addr);
        if (data.localidade) setCity(String(data.localidade));
        if (st) setStateUF(st);

        setCityLocked(true);
        setStateAutoHint("Auto (CEP)");
        setZipLoading(false);

        zipCacheRef.current.set(cacheKey, {
          address: addr,
          city: data.localidade ? String(data.localidade) : "",
          stateUF: st,
          stateAutoHint: "Auto (CEP)",
        });

        return;
      }

      // Outros: Zippopotam (cidade/estado)
      const code = countryToZippopotamCode(selectedCountry);
      if (!code) {
        setZipLoading(false);
        setZipError("Busca automática indisponível para este país.");
        setCityLocked(false);
        return;
      }

      const res = await fetch(
        `https://api.zippopotam.us/${code}/${encodeURIComponent(cleaned)}`,
        {
          signal: controller.signal,
        },
      );

      if (!res.ok) {
        setZipLoading(false);
        setZipError("Postal code inválido ou não encontrado.");
        setCityLocked(false);
        return;
      }

      const data = (await res.json()) as any;

      const place = data?.places?.[0];
      const placeName = place?.["place name"]
        ? String(place["place name"])
        : "";
      const regionName = place?.state ? String(place.state) : "";
      const regionAbbr = place?.["state abbreviation"]
        ? String(place["state abbreviation"])
        : "";

      if (placeName) setCity(placeName);

      let nextState = stateUF;
      let hint = "Auto (Postal)";

      if (selectedCountry === "United States") {
        const mapped = US_ABBR_TO_STATE[regionAbbr] || regionName;
        if (mapped && US_STATES.includes(mapped)) nextState = mapped;
        else if (regionName) nextState = regionName;
        setStateAutoHint("Auto (ZIP)");
        hint = "Auto (ZIP)";
      } else {
        if (regionName) nextState = regionName;
        setStateAutoHint("Auto (Postal)");
        hint = "Auto (Postal)";
      }

      if (nextState) setStateUF(nextState);

      // Zippopotam não entrega rua, então não forçamos address
      setCityLocked(true);
      setZipLoading(false);

      zipCacheRef.current.set(cacheKey, {
        address: "",
        city: placeName,
        stateUF: nextState,
        stateAutoHint: hint,
      });
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setZipLoading(false);
      setZipError("Falha ao buscar endereço. Tente novamente.");
      setCityLocked(false);
    }
  }

  async function refreshPixWithCoupon(code: string | null) {
    if (method !== "pix") return;
    if (pixStep !== "qr") return;
    if (!pixPaymentId) return;
    if (!pixCpf || !pixName) return;

    // se já foi aprovado, não mexe
    if (liveStatus === "approved") return;

    setActionState("loading");

    try {
      const nextRevision = (orderRevision || 0) + 1;

      const res = await fetch("/api/pagment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({
          method: "pix",
          plan: safePlan,
          billing: safeBilling,
          planTitle,
          planDescription,
          payer: { cpf: onlyDigits(pixCpf), name: pixName },

          //  aqui: se code for null/vazio, manda null (remove cupom)
          coupon: code && code.trim() ? code.trim() : null,

          //  manda para o backend cancelar o antigo e criar outro
          replace_payment_id: pixPaymentId,
          order_id: orderId,
          revision: nextRevision,
        }),
      });

      const j = await res.json().catch(() => null);

      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "Sessão expirada ou sem permissão (403). Faça login novamente e tente gerar o Pix.",
        );
      }

      if (!res.ok || !j?.ok)
        throw new Error(j?.message || "Falha ao regerar Pix.");

      const newId = String(j.id ?? "") || null;

      setPixQrBase64(j.qr_code_base64 || null);
      setPixCopyPaste(j.qr_code || "");
      setPixPaymentId(newId);

      if (j.order_id) setOrderId(String(j.order_id));
      if (typeof j.revision === "number") setOrderRevision(j.revision);

      stopPolling();
      if (newId) startPollingPayment(newId, "pix");

      setActionState("success");
      actionTimerRef.current = window.setTimeout(
        () => setActionState("idle"),
        900,
      );
    } catch {
      setActionState("error");
      actionTimerRef.current = window.setTimeout(
        () => setActionState("idle"),
        1200,
      );
    }
  }

  function resetPixForRetry() {
    // ✅ para qualquer polling atual
    stopPolling();

    // ✅ limpa QR e ID antigo
    setPixQrBase64(null);
    setPixCopyPaste("");
    setPixPaymentId(null);

    // ✅ volta pro começo (igual primeira vez)
    setPixStep("form");

    // ✅ limpa dados pra digitar de novo
    setPixName("");
    setPixCpf("");
    setPixNameError(null);
    setPixCpfError(null);

    // ✅ limpa UI de status antigo (evita "falhou" instantâneo no novo Pix)
    try {
      // se você tiver esses states, mantém:
      setLiveStatus("pending" as any);
      setLiveStatusDetail(null as any);
    } catch {}

    setActionState("idle");
    clearActionTimer();
  }

  function handleZipBlur() {
    if (!zip.trim()) return;
    if (!isZipComplete(country, zip)) {
      setZipError("Digite um postal code válido.");
      setCityLocked(false);
      return;
    }
    lookupPostal(zip, country);
  }

  // Auto lookup (debounce) quando completar o ZIP — UX premium
  useEffect(() => {
    if (!open) return;
    if (!zip.trim()) return;

    if (zipDebounceRef.current) window.clearTimeout(zipDebounceRef.current);

    // se ainda não completou, não chama
    if (!isZipComplete(country, zip)) {
      setCityLocked(false);
      return;
    }

    zipDebounceRef.current = window.setTimeout(() => {
      lookupPostal(zip, country);
    }, 520);

    return () => {
      if (zipDebounceRef.current) window.clearTimeout(zipDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zip, country, open]);

  function startCouponEditSmart() {
    if (uiLocked) return; // ✅ não deixa mexer após aprovado

    setCouponError(null);
    setCouponValidating(false);
    setCouponMode("editing");

    // ✅ remove meta aplicada pra recalcular total sem cupom
    setAppliedCouponMeta(null);

    // ✅ ao entrar em edição (veio de "applied"), já remove cupom no Pix e regera o QR
    setTimeout(() => {
      if (!uiLocked) refreshPixWithCoupon(null);
    }, 0);
  }

  function cancelCouponEdit() {
    setCouponError(null);
    setCouponValidating(false);

    if (lastAppliedRef.current) {
      setCoupon(lastAppliedRef.current);
      setCouponMode("applied");
      // ✅ mantém meta aplicada (não mexe)
      return;
    }

    setAppliedCouponMeta(null);
    setCouponMode("closed");
  }

  async function validateCoupon(rawValue?: string) {
    if (uiLocked) return; // ✅ não deixa mexer após aprovado

    const source = typeof rawValue === "string" ? rawValue : coupon;
    const code = source.trim().toUpperCase();

    // apagou => remove e regera Pix se já tiver QR
    if (!code) {
      setCouponError(null);
      setCouponValidating(false);

      lastAppliedRef.current = "";
      setCoupon("");
      setCouponMode("closed");

      setAppliedCouponMeta(null);

      setTimeout(() => {
        if (!uiLocked) refreshPixWithCoupon(null);
      }, 0);

      return;
    }

    setCouponError(null);
    setCouponValidating(true);

    try {
      const res = await fetch(
        `/api/pagment/cupom?code=${encodeURIComponent(code)}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
        },
      );

      const j = await res.json().catch(() => null);

      if (!res.ok || !j?.ok) {
        throw new Error(j?.message || "Falha ao validar cupom.");
      }

      if (!j.valid) {
        setCouponValidating(false);
        setCouponError(j?.message || "Cupom inválido ou indisponível.");
        setCouponMode("editing");
        setTimeout(() => couponRef.current?.focus(), 10);
        return;
      }

      // ✅ válido
      lastAppliedRef.current = code;
      setCoupon(code);
      setCouponMode("applied");

      setAppliedCouponMeta({
        code,
        source: j.source,
        discount: {
          kind: j.discount?.kind,
          percent: j.discount?.percent ?? null,
          amount_cents: j.discount?.amount_cents ?? null,
          target_total_cents: j.discount?.target_total_cents ?? null,
        },
      });

      setCouponValidating(false);

      setTimeout(() => {
        if (!uiLocked) refreshPixWithCoupon(code);
      }, 0);
    } catch {
      setCouponValidating(false);
      setCouponError("Cupom inválido ou indisponível.");
      setCouponMode("editing");
      setTimeout(() => couponRef.current?.focus(), 10);
    }
  }

  function validateEmailField(v: string) {
    const ok = isValidEmail(v);
    return ok
      ? null
      : "Email inválido. Por favor, Revise e insira-o novamente.";
  }

  function validateCpfField(v: string) {
    const d = onlyDigits(v);
    if (d.length !== 11)
      return "CPF inválido. Por favor, Revise e insira-o novamente.";
    if (!isValidCPF(d))
      return "CPF inválido. Por favor, Revise e insira-o novamente.";
    return null;
  }

  function computeCardErrorsSnapshot() {
    const next: {
      cardNumber?: string | null;
      exp?: string | null;
      cvc?: string | null;
    } = {};

    const digits = onlyDigits(cardNumber);
    const b = detectBrand(digits);

    const allowed = getCardAllowedLengths(b);
    if (!allowed.includes(digits.length)) {
      next.cardNumber =
        "Número do cartão inválido. Por favor, Revise e insira-o novamente.";
    } else if (!luhnCheck(digits)) {
      next.cardNumber = "Número do cartão inválido.";
    } else {
      next.cardNumber = null;
    }

    const parsed = parseExpiry(exp);
    if (!parsed) {
      next.exp = "Validade inválida (MM / AA).";
    } else {
      const { month, year } = parsed;
      if (month < 1 || month > 12) {
        next.exp = "Mês inválido.";
      } else {
        const now = new Date();
        const curMonth = now.getMonth() + 1;
        const curYear = now.getFullYear();
        const isPast = year < curYear || (year === curYear && month < curMonth);
        next.exp = isPast ? "Cartão expirado." : null;
      }
    }

    const cvcDigits = onlyDigits(cvc);
    const cvcExpected = b === "amex" ? 4 : 3;
    if (cvcDigits.length !== cvcExpected) {
      next.cvc = `CVC inválido (${cvcExpected} dígitos).`;
    } else {
      next.cvc = null;
    }

    const ok = !next.cardNumber && !next.exp && !next.cvc;
    return { next, ok };
  }

  function validateCardFields() {
    const { next, ok } = computeCardErrorsSnapshot();
    setCardErrors(next);
    return ok;
  }

 function validateCardForm() {
  const eErr = validateEmailField(email);
  setEmailError(eErr);

  const cErr = validateCpfField(cpf);
  setCardCpfError(cErr);

  const nameErr =
    holderName.trim().replace(/\s+/g, " ").length >= 3
      ? null
      : "Digite o nome completo do titular.";
  setHolderNameError(nameErr);

  // ✅ NOVO: obrigatórios no Card
  const z = onlyDigits(zip);
  const zipErrLocal = isZipComplete(country, zip)
    ? null
    : country === "Brasil"
      ? "CEP inválido."
      : "Código postal inválido.";
  setZipError(zipErrLocal);

  const addr = address.trim().replace(/\s+/g, " ");
  const addressErrLocal =
    addr.length >= 3 ? null : "Endereço de cobrança obrigatório.";
  setAddressError(addressErrLocal);

  const cty = city.trim().replace(/\s+/g, " ");
  const cityErrLocal = cty.length >= 2 ? null : "Cidade obrigatória.";
  setCityError(cityErrLocal);

  const { next, ok: cardsOk } = computeCardErrorsSnapshot();
  setCardErrors(next);

  // ✅ inclui os 3 novos no gate
  if (
    eErr ||
    cErr ||
    nameErr ||
    !cardsOk ||
    zipErrLocal ||
    addressErrLocal ||
    cityErrLocal
  ) {
    if (eErr) emailRef.current?.focus();
    else if (next.cardNumber) cardNumberRef.current?.focus();
    else if (next.exp) expRef.current?.focus();
    else if (next.cvc) cvcRef.current?.focus();
    else if (nameErr) holderNameRef.current?.focus();
    else if (zipErrLocal) zipRef.current?.focus();
    else if (addressErrLocal) addressRef.current?.focus();
    else if (cityErrLocal) cityRef.current?.focus();
    else if (cErr) cpfRef.current?.focus();
    return false;
  }

  return true;
}

  function validatePixForm() {
    const n = pixName.trim().replace(/\s+/g, " ");
    const nErr = n.length >= 3 ? null : "Digite seu nome completo.";
    setPixNameError(nErr);

    const cErr = validateCpfField(pixCpf);
    setPixCpfError(cErr);

    if (nErr) {
      pixNameRef.current?.focus();
      return false;
    }

    if (cErr) {
      pixCpfRef.current?.focus();
      return false;
    }

    return true;
  }

  type PaymentUI = {
    id?: string | number | null;
    receipt_url?: string | null;
    ticket_url?: string | null;
  };

  const [payment, setPayment] = useState<PaymentUI | null>(null);

  function downloadBoleto() {
    const url =
      payment?.receipt_url || boletoTicketUrl || payment?.ticket_url || "";

    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function validateBoletoForm() {
    const next: any = {};

    const n = boletoName.trim().replace(/\s+/g, " ");
    next.name = n.length >= 3 ? null : "Digite seu nome completo.";

    next.cpf = validateCpfField(boletoCpf);
    next.email = validateEmailField(boletoEmail);

    const z = onlyDigits(boletoZip);
    next.zip = z.length === 8 ? null : "CEP inválido.";

    next.street_name =
      boletoStreetName.trim().length >= 2 ? null : "Rua obrigatória.";
    next.street_number =
      boletoStreetNumber.trim().length >= 1 ? null : "Número obrigatório.";
    next.neighborhood =
      boletoNeighborhood.trim().length >= 2 ? null : "Bairro obrigatório.";
    next.city = boletoCity.trim().length >= 2 ? null : "Cidade obrigatória.";
    next.federal_unit = boletoUF.trim().length === 2 ? null : "UF inválida.";

    setBoletoErrors(next);

    if (next.email) return (boletoEmailRef.current?.focus(), false);
    if (next.name) return (boletoNameRef.current?.focus(), false);
    if (next.cpf) return (boletoCpfRef.current?.focus(), false);

    // foco nos campos de endereço
    if (next.zip) return false;
    if (next.street_name) return false;
    if (next.street_number) return false;
    if (next.neighborhood) return false;
    if (next.city) return false;
    if (next.federal_unit) return false;

    return true;
  }

  async function copyPix() {
    if (!pixCode) return;

    try {
      await safeClipboardWrite(pixCode);

      setPixCopied(true);
      setPixCopyPulse((p) => p + 1);

      window.setTimeout(() => setPixCopied(false), 1200);
    } catch {
      setPixCopied(false);
    }
  }

  async function createPayment(methodToCreate: "pix" | "boleto") {
    const res = await fetch("/api/pagment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({
        method: methodToCreate,
        plan: safePlan,
        billing: safeBilling,
        planTitle,
        planDescription,
        payer:
          methodToCreate === "pix"
            ? { email: discordEmail, cpf: onlyDigits(pixCpf), name: pixName }
            : {
                email: boletoEmail,
                cpf: onlyDigits(boletoCpf),
                name: boletoName,
                address: {
                  zip_code: onlyDigits(boletoZip),
                  street_name: boletoStreetName,
                  street_number: boletoStreetNumber,
                  neighborhood: boletoNeighborhood,
                  city: boletoCity,
                  federal_unit: boletoUF,
                },
              },

        send_email: methodToCreate === "boleto",
        coupon: couponMode === "applied" ? coupon.trim() : null,
      }),
    });

    const data = await res.json().catch(() => null);

    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Sessão expirada ou sem permissão (403). Faça login novamente e tente gerar o pagamento.",
      );
    }

    if (!res.ok || !data?.ok) {
      throw new Error(
        safeText((data as any)?.message, "Falha ao gerar pagamento."),
      );
    }

    // sanitiza campos vindos do backend pra nunca virar {} no state
    (data as any).id = safeStringOrNull((data as any).id);
    (data as any).qr_code = safeStringOrNull((data as any).qr_code);
    (data as any).qr_code_base64 = safeStringOrNull(
      (data as any).qr_code_base64,
    );
    (data as any).ticket_url = safeStringOrNull((data as any).ticket_url);
    (data as any).barcode = safeStringOrNull((data as any).barcode);
    (data as any).order_id = safeStringOrNull((data as any).order_id);

    return data as {
      ok: true;
      method: "pix" | "boleto";
      id?: string | number | null;
      status?: string | null;
      qr_code?: string | null;
      qr_code_base64?: string | null;
      ticket_url?: string | null;
      barcode?: string | null;
      order_id?: string | null;
      revision?: number;
      pricing?: {
        base: number;
        discount: number;
        total: number;
        coupon: string | null;
      };
    };
  }
  // Progress (inteligência visual)
  const cardValidity = useMemo(() => {
    const eOk = !validateEmailField(email);
    const cOk = !validateCpfField(cpf);

    const digits = onlyDigits(cardNumber);
    const b = detectBrand(digits);
    const allowed = getCardAllowedLengths(b);
    const cardOk = allowed.includes(digits.length) && luhnCheck(digits);

    const parsed = parseExpiry(exp);
    let expOk = false;
    if (parsed) {
      const { month, year } = parsed;
      if (month >= 1 && month <= 12) {
        const now = new Date();
        const curMonth = now.getMonth() + 1;
        const curYear = now.getFullYear();
        expOk = !(year < curYear || (year === curYear && month < curMonth));
      }
    }

    const cvcExpected = b === "amex" ? 4 : 3;
    const cvcOk = onlyDigits(cvc).length === cvcExpected;

    const nameOk = holderName.trim().length >= 3;

    const total = 6;
    const done = [eOk, cardOk, expOk, cvcOk, nameOk, cOk].filter(
      Boolean,
    ).length;
    const pct = Math.round((done / total) * 100);

    return { eOk, cOk, cardOk, expOk, cvcOk, nameOk, done, total, pct };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, cpf, cardNumber, exp, cvc, holderName]);

  const boletoValidity = useMemo(() => {
    const nOk = boletoName.trim().length >= 3;
    const cOk = !validateCpfField(boletoCpf);
    const eOk = !validateEmailField(boletoEmail);

    const total = 3;
    const done = [nOk, cOk, eOk].filter(Boolean).length;
    const pct = Math.round((done / total) * 100);

    return { nOk, cOk, eOk, done, total, pct };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boletoName, boletoCpf, boletoEmail]);

  type FinalStatus = "approved" | "cancelled" | "expired" | "rejected";

  const [localFinalStatus, setLocalFinalStatus] = useState<FinalStatus | null>(
    null,
  );

  // ✅ status efetivo: polling (liveStatus) OU finalização local (cartão)
  const effectiveStatus = localFinalStatus ?? liveStatus;

const paymentLockedByStatus =
  effectiveStatus === "approved" ||
  effectiveStatus === "cancelled" ||
  effectiveStatus === "expired" ||
  effectiveStatus === "rejected";

  // ✅ aprovado global (vale pra qualquer método)
  const paymentApproved = effectiveStatus === "approved";

  // ✅ trava UI depois de aprovado
  const uiLocked = paymentApproved;

  // Auto-avanço (inteligência) sem ser agressivo
  const lastCardDigitsLenRef = useRef(0);
  const lastExpDigitsLenRef = useRef(0);

  function resetFlowForRetry() {
  // ✅ limpa qualquer status final global pra sair da tela de falha e destravar abas
  setLiveStatus(null);
  setLiveStatusDetail(null);

  // destrava status final (inclusive cartão)
  setLocalFinalStatus(null);

  // encerra polling / timers
  stopPolling();
  clearActionTimer();
  setActionState("idle");

  // destrava cupom (volta pro estado fechado)
setCouponError(null);
setCouponValidating(false);
couponInteractedRef.current = false;

  // reseta por método
  if (method === "pix") {
    resetPixForRetry();
    return;
  }

  if (method === "boleto") {
    setBoletoStep("form");
    setBoletoPaymentId("");
    setBoletoTicketUrl(null);
    setBoletoBarcode(null);
    setPayment(null);
    setBoletoSentToEmail("");
    setBoletoErrors({});

    // (opcional, mas fica “como no início”)
    setBoletoEmail(discordEmail || "");
    setBoletoName("");
    setBoletoCpf("");
    setBoletoZip("");
    setBoletoStreetName("");
    setBoletoStreetNumber("");
    setBoletoNeighborhood("");
    setBoletoCity("");
    setBoletoUF("SP");
    return;
  }

  // card: volta pro início
  setEmail(discordEmail || "");
  setCpf("");
  setCardNumber("");
  setExp("");
  setCvc("");
  setHolderName("");
  setEmailError(null);
  setCardCpfError(null);
  setHolderNameError(null);
  setCardErrors({});

  cardEmailTouchedRef.current = false;
  lastCardDigitsLenRef.current = 0;
  lastExpDigitsLenRef.current = 0;
}

  async function handlePrimaryAction() {
    const failedNow =
      effectiveStatus === "expired" ||
      effectiveStatus === "rejected" ||
      effectiveStatus === "cancelled";

    // ✅ se falhou (em qualquer método/tela), o botão vira retry e reseta tudo
    if (failedNow) {
      resetFlowForRetry();
      return;
    }

    if (uiLocked) return; // ✅ após aprovado, não faz mais nada
    clearActionTimer();

    

    setActionState("idle");

    

    if (method === "card") {
      const ok = validateCardForm();
      if (!ok) {
        setShakeSignal((s) => s + 1);
        setActionState("error");
        actionTimerRef.current = window.setTimeout(
          () => setActionState("idle"),
          650,
        );
        return;
      }

      // Mantive seu fluxo — mas o endpoint avisa que cartão real precisa tokenização (MercadoPago.js/Bricks)
      setActionState("loading");
      try {
        await fetch("/api/pagment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            method: "card",
            plan: safePlan,
            billing: safeBilling,
            planTitle,
            planDescription,
            payer: { email, cpf, name: holderName },
          }),
        });

        // ✅ fixa aprovado (igual Pix) e não volta pro botão “Pagar”
        setLocalFinalStatus("approved");
        setActionState("idle");
      } catch {
        // (opcional) se você quiser: setLocalFinalStatus("rejected");
        setActionState("error");
        actionTimerRef.current = window.setTimeout(
          () => setActionState("idle"),
          900,
        );
      }

      return;
    }

    if (method === "boleto") {
      const ok = validateBoletoForm();
      if (!ok) {
        setShakeSignal((s) => s + 1);
        setActionState("error");
        actionTimerRef.current = window.setTimeout(
          () => setActionState("idle"),
          650,
        );
        return;
      }

      setActionState("loading");
      try {
        const data = await createPayment("boleto");

        const id = String(data.id ?? "").trim() || "";
        if (!id) throw new Error("Falha ao gerar boleto (ID inválido).");

        setBoletoPaymentId(id);

        // ✅ já preenche imediatamente
        setBoletoTicketUrl(data.ticket_url || null);
        setBoletoBarcode(data.barcode || null);

        setPayment({
          id,
          ticket_url: data.ticket_url || null,
          receipt_url: (data as any)?.receipt_url || null,
        });

        setBoletoSentToEmail(boletoEmail || discordEmail || "");
        setBoletoStep("generated");

        // “apaga os inputs” (limpa states do form)
        setBoletoName("");
        setBoletoCpf("");
        setBoletoZip("");
        setBoletoStreetName("");
        setBoletoStreetNumber("");
        setBoletoNeighborhood("");
        setBoletoCity("");
        setBoletoUF("SP");
        setBoletoErrors({});

        startPollingPayment(id, "boleto");

        setActionState("success");
        actionTimerRef.current = window.setTimeout(
          () => setActionState("idle"),
          1800,
        );
      } catch {
        setActionState("error");
        actionTimerRef.current = window.setTimeout(
          () => setActionState("idle"),
          1200,
        );
      }
      return;
    }

    // pix (2 etapas)
    if (method === "pix") {
      // Etapa 1: validar e GERAR
      if (pixStep === "form") {
        const ok = validatePixForm();
        if (!ok) {
          setShakeSignal((s) => s + 1);
          setActionState("error");
          actionTimerRef.current = window.setTimeout(
            () => setActionState("idle"),
            650,
          );
          return;
        }

        setActionState("loading");
        try {
          const data = await createPayment("pix");
          //  salve sessão
          if (data.order_id) setOrderId(String(data.order_id));
          if (typeof data.revision === "number")
            setOrderRevision(data.revision);
          const id = String(data.id ?? "") || null;

          setPixQrBase64(data.qr_code_base64 || null);
          setPixCopyPaste(data.qr_code || "");
          setPixPaymentId(id);

          if (couponMode === "applied" && coupon.trim()) {
            fetch("/api/pagment/cupom", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              credentials: "include",
              cache: "no-store",
              body: JSON.stringify({
                action: "claim",
                code: coupon.trim(),
                payment_id: id,
                order_id: data.order_id || null,
              }),
            }).catch(() => {});
          }

          if (id) startPollingPayment(id, "pix");

          // some inputs, aparece bloco do QR
          setPixStep("qr");

          setActionState("success");
          actionTimerRef.current = window.setTimeout(
            () => setActionState("idle"),
            900,
          );
        } catch {
          setActionState("error");
          actionTimerRef.current = window.setTimeout(
            () => setActionState("idle"),
            1200,
          );
        }
        return;
      }

      // Etapa 2: agora o botão fica travado em "Aguardando Pagamento".
      // Se falhar => "Tentar novamente" RESETA (volta pro form) pra pessoa digitar tudo de novo.
      if (pixStep === "qr") {
        const failed =
          liveStatus === "cancelled" ||
          liveStatus === "expired" ||
          liveStatus === "rejected";

        if (failed) {
          resetPixForRetry(); // ✅ agora volta pro estado inicial
        }

        return;
      }
    }
  }

  useEffect(() => {
    return () => {
      clearActionTimer();
      zipAbortRef.current?.abort();
      stopPolling();
    };
  }, [clearActionTimer, stopPolling]);

  const showApprovedAny = effectiveStatus === "approved";

  // 🔒 Travar UI quando finalizado (aprovado ou falhou)
  const isApproved = effectiveStatus === "approved";

  // trava abas + cupom igual aprovado
  const lockTabsAndCoupon = isApproved || isFailed;


  const primaryBtnLabelResolved = showRetryCta
    ? "Tentar novamente"
    : paymentApproved
      ? "Pagamento Efetuado"
      : primaryBtnLabel;

  const primaryBtnDisabledResolved = showRetryCta
    ? actionState === "loading"
    : paymentApproved
      ? true
      : primaryBtnDisabled;

  const showFailedAny =
    effectiveStatus === "cancelled" ||
    effectiveStatus === "expired" ||
    effectiveStatus === "rejected";

  const showPixQrFailed =
    pixStep === "qr" &&
    (effectiveStatus === "cancelled" ||
      effectiveStatus === "expired" ||
      effectiveStatus === "rejected");

  const showPixSuccess =
    pixStep === "success" || effectiveStatus === "approved";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-6 row-pay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
        >
          {/* WRAPPER (overflow visível) pra permitir o X fora do card */}
          <div
            className="relative w-[1200px] max-w-[96vw]
               h-[96svh] md:h-[92svh] max-h-[96svh] md:max-h-[92svh]
               overflow-visible"
          >
            {/* X EXTERNO (lado direito fora do card) */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar checkout"
              className="absolute -top right-0 translate-x-[56px] z-[10010]
                 rounded-xl border border-white/10 bg-black/60 p-2
                 text-white/60 hover:text-white hover:bg-black/80 transition
                 shadow-[0_18px_55px_rgba(0,0,0,0.55)]"
            >
              <IconClose className="h-7 w-7" />
            </button>

            {/* ✅ DEV BUTTON (canto inferior esquerdo do modal) */}
            {devAllowed && (
              <div
                ref={devWrapRef}
                className="absolute left-4 bottom-4 z-[10020]"
              >
                <button
                  type="button"
                  onClick={() => {
                    setDevError(null);
                    setDevMenuOpen((s) => !s);
                  }}
                  className="rounded-xl border border-white/10 bg-black/70 px-3 py-2
                   text-[11px] font-semibold text-white/80 hover:bg-black/85 transition
                   shadow-[0_18px_55px_rgba(0,0,0,0.55)] backdrop-blur-xl"
                >
                  DEV
                </button>

                <AnimatePresence>
                  {devMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.98 }}
                      transition={{ duration: 0.18, ease: "easeOut" }}
                      className="mt-2 w-[220px] overflow-hidden rounded-2xl border border-white/10
               bg-black/75 backdrop-blur-2xl
               shadow-[0_28px_80px_rgba(0,0,0,0.70)]"
                    >
                      <div className="p-2 space-y-2">
                        <button
                          type="button"
                          onClick={() => runDevAction("approve")}
                          disabled={!!devActionLoading}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2
                   text-left text-[12px] font-semibold text-white/85 hover:bg-white/[0.06] transition
                   disabled:opacity-60"
                        >
                          {devActionLoading === "approve"
                            ? "Aprovando..."
                            : "Aprovar"}
                        </button>

                        <button
                          type="button"
                          onClick={() => runDevAction("reject")}
                          disabled={!!devActionLoading}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2
                   text-left text-[12px] font-semibold text-white/85 hover:bg-white/[0.06] transition
                   disabled:opacity-60"
                        >
                          {devActionLoading === "reject"
                            ? "Recusando..."
                            : "Recusar"}
                        </button>

                        <button
                          type="button"
                          onClick={() => runDevAction("expire")}
                          disabled={!!devActionLoading}
                          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2
                   text-left text-[12px] font-semibold text-white/85 hover:bg-white/[0.06] transition
                   disabled:opacity-60"
                        >
                          {devActionLoading === "expire"
                            ? "Expirando..."
                            : "Expirar"}
                        </button>

                        {!!devError && (
                          <div className="pt-1 text-[11px] text-red-400/90">
                            {devError}
                          </div>
                        )}

                        <div className="pt-1 text-[10px] text-white/35">
                          *Ação DEV (simulação de status)
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            <motion.div
              ref={modalCardRef}
              onClick={(e) => e.stopPropagation()}
              initial={
                reduceMotion
                  ? { opacity: 0 }
                  : { scale: 0.965, opacity: 0, y: 10 }
              }
              animate={
                reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1, y: 0 }
              }
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : { scale: 0.965, opacity: 0, y: 10 }
              }
              transition={
                reduceMotion
                  ? { duration: 0.15 }
                  : { duration: 0.35, ease: "easeOut" }
              }
              className="relative w-full h-full
                 overflow-hidden rounded-3xl border border-white/10
                 bg-gradient-to-b from-white/[0.06] to-white/[0.02]
                 backdrop-blur-3xl shadow-2xl"
            >
              {/* TOP GLOW */}
              <div className="pointer-events-none absolute inset-x-0 -top-24 h-40 opacity-70">
                <div className="mx-auto h-full w-[70%] rounded-full bg-[#214FC4]/20 blur-3xl" />
              </div>

              {/* WRAPPER */}
              <div className="h-full overflow-y-auto lg:overflow-hidden overscroll-contain">
                <div className="flex min-h-full flex-col lg:grid lg:h-full lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                  {/* LEFT */}
                  <div className="relative border-b border-white/10 lg:border-b-0 lg:border-r border-white/10 min-w-0">
                    <div className="lg:h-full lg:overflow-y-auto min-w-0">
                      <div className="px-5 sm:px-8 pt-8 pb-6">
                        <div className="flex items-center justify-between">
                          <div className="min-w-0 w-full">
                            <div className="flex items-center gap-2 text-[13px] text-white/45">
                              <span>Início</span>
                              <span className="text-white/25">/</span>
                              <span className="text-white/70">Pagamento</span>
                            </div>

                            <div className="mt-6 flex w-full items-center gap-4">
                              <h2 className="text-[26px] font-semibold text-white">
                                Seu Pagamento
                              </h2>

                              <div className="ml-auto inline-flex items-center gap-2 px-4 py-2 text-[12px] text-white/45">
                                <IconLock className="text-white/45" />
                                <span>Transação segura</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* ITEM 1 */}
                        <motion.div
                          initial={
                            reduceMotion
                              ? { opacity: 0 }
                              : { opacity: 0, y: 10 }
                          }
                          animate={
                            reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }
                          }
                          transition={
                            reduceMotion
                              ? { duration: 0.12 }
                              : { duration: 0.35, ease: "easeOut", delay: 0.05 }
                          }
                          className="mt-7 rounded-2xl border border-white/10 bg-black/25
                                   shadow-[0_22px_60px_rgba(0,0,0,0.55)] overflow-hidden"
                        >
                          <div className="flex gap-4 p-4">
                            <div className="relative h-[82px] w-[92px] shrink-0 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.10] to-white/[0.03]">
                              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.20),transparent_55%)]" />
                              <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,rgba(33,79,196,0.25),transparent_55%)]" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="truncate text-[14px] font-semibold text-white">
                                      {safePlanTitle}
                                    </span>
                                    <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-white/70">
                                      {billingLabel}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 text-[12px] text-white/45 truncate">
                                    {safePlanDescription} • {billingNote}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-col items-end justify-between">
                              <button
                                type="button"
                                onClick={onClose}
                                className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-white/35 hover:text-white hover:bg-white/[0.06] transition"
                                aria-label="Fechar checkout"
                              >
                                <IconClose className="h-4 w-4" />
                              </button>
                              <div className="text-[14px] font-semibold text-white/90">
                                {formatBRL(order.subtotal)}
                              </div>
                            </div>
                          </div>
                        </motion.div>

                        {/* DISCOUNT */}
                        <motion.div
                          initial={
                            reduceMotion
                              ? { opacity: 0 }
                              : { opacity: 0, y: 10 }
                          }
                          animate={
                            reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }
                          }
                          transition={
                            reduceMotion
                              ? { duration: 0.12 }
                              : { duration: 0.35, ease: "easeOut", delay: 0.15 }
                          }
                          className="mt-4 rounded-2xl border border-white/10 bg-black/25
                                   shadow-[0_22px_60px_rgba(0,0,0,0.55)] overflow-hidden"
                        >
                          <div className="relative p-4">
                            <div className="pointer-events-none absolute inset-0 opacity-[0.45]">
                              <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.10),transparent_55%)]" />
                              <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_70%,rgba(33,79,196,0.18),transparent_55%)]" />
                              <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.05)_50%,transparent_100%)]" />
                            </div>

                            <div className="relative flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                                  <span className="text-white/80">%</span>
                                </div>
                                <div>
                                  <div className="text-[13px] font-semibold text-white">
                                    Código de Apoiador
                                  </div>
                                  <div className="text-[12px] text-white/45">
                                    Digite o código para aplica-lo
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center justify-end">
                                <motion.div
                                  layout
                                  style={{ originX: 1 }}
                                  animate={{
                                    width:
                                      couponMode === "editing"
                                        ? 340
                                        : couponMode === "applied"
                                          ? 320
                                          : 140,
                                  }}
                                  transition={{
                                    type: "spring",
                                    stiffness: reduceMotion ? 220 : 520,
                                    damping: reduceMotion ? 32 : 34,
                                  }}
                                  className="relative"
                                >
                                  <AnimatePresence mode="wait">
                                    {couponMode === "editing" ? (
                                      <motion.div
                                        ref={couponBoxRef}
                                        key="coupon-edit"
                                        initial={{ opacity: 0, x: 10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 10 }}
                                        transition={{
                                          duration: 0.18,
                                          ease: "easeOut",
                                        }}
                                        className={`relative h-[42px] w-full rounded-xl border bg-white/[0.03]
                                          shadow-[0_18px_55px_rgba(0,0,0,0.45)]
                                          ${couponError ? "border-red-500/60" : "border-white/10"}`}
                                      >
                                        <input
                                          ref={couponRef}
                                          value={coupon}
                                          disabled={lockTabsAndCoupon}
                                          onPointerDown={() => {
                                            couponInteractedRef.current = true; // ✅ clicou no input
                                          }}
                                          onChange={(e) => {
                                            couponInteractedRef.current = true; // ✅ começou a digitar
                                            setCoupon(e.target.value);
                                          }}
                                          onBlur={(e) => {
                                            const v = e.currentTarget.value;
                                            if (!v.trim()) {
                                              // ✅ apagou tudo e saiu do focus: volta para "Add code" + dispara regerar Pix
                                              validateCoupon(v);
                                            }
                                          }}
                                          onKeyDown={(e) => {
                                            couponInteractedRef.current = true; // ✅ teclado também conta como interação

                                            if (e.key === "Enter") {
                                              e.preventDefault();
                                              validateCoupon();
                                            }
                                            if (e.key === "Escape") {
                                              e.preventDefault();
                                              cancelCouponEdit();
                                            }
                                          }}
                                          placeholder="Digite seu código de apoiador"
                                          className="h-full w-full bg-transparent pl-3 pr-[68px] text-[12px] text-white/85 outline-none placeholder:text-white/35"
                                        />

                                        <div className="absolute right-0.5 top-1/2 -translate-y-1/2">
                                          {couponValidating ? (
                                            <div
                                              className="h-[36px] w-[44px] rounded-lg border border-white/10 bg-white/[0.03]
                                                          inline-flex items-center justify-center"
                                            >
                                              <SpinnerMini />
                                            </div>
                                          ) : (
                                            <button
                                              type="button"
                                              disabled={uiLocked}
                                              onClick={() => validateCoupon()} // ✅ chama a função (resolve o "vermelho")
                                              className="h-[36px] px-4 rounded-[10px] border border-white/10 bg-white/[0.03]
                                                  text-[12px] font-semibold text-white/85
                                                  hover:bg-white/[0.06] transition"
                                              aria-label="Validar cupom"
                                            >
                                              OK
                                            </button>
                                          )}
                                        </div>
                                      </motion.div>
                                    ) : couponMode === "applied" ? (
                                      <motion.button
                                        key="coupon-applied"
                                        type="button"
                                        disabled={lockTabsAndCoupon}
                                        onClick={() => {
                                          if (lockTabsAndCoupon) return;
                                          startCouponEditSmart();
                                        }}
                                        initial={{ opacity: 0, x: 10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 10 }}
                                        transition={{
                                          duration: 0.18,
                                          ease: "easeOut",
                                        }}
                                        className="h-[42px] w-full rounded-xl border border-[#214FC4]/40 bg-[#214FC4]/15
                                              px-4 text-[12px] font-semibold text-white/85
                                              hover:bg-[#214FC4]/20 transition inline-flex items-center justify-between gap-3"
                                      >
                                        <span className="truncate">
                                          Código promocional aplicado
                                        </span>
                                        <span className="flex items-center justify-center">
                                          <IconVerifiedBlue className="h-5 w-5 shrink-0" />
                                        </span>
                                      </motion.button>
                                    ) : (
                                      <motion.button
                                        key="coupon-closed"
                                        type="button"
                                        disabled={lockTabsAndCoupon}
                                        onClick={() => {
                                          if (lockTabsAndCoupon) return;

                                          setCouponError(null);
                                          setCouponValidating(false);
                                          couponInteractedRef.current = false;
                                          setCouponMode("editing");
                                        }}
                                        className={`h-[42px] w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 text-[12px] font-semibold text-white/70 hover:bg-white/[0.06] hover:text-white transition inline-flex items-center justify-center ${lockTabsAndCoupon ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
                                      >
                                        Add code
                                      </motion.button>
                                    )}
                                  </AnimatePresence>
                                </motion.div>
                              </div>
                            </div>
                          </div>
                        </motion.div>

                        <div className="mt-2">
                          <AnimatedError error={couponError} />
                        </div>

                        {/* TOTAL BOX */}
                        <motion.div
                          initial={
                            reduceMotion
                              ? { opacity: 0 }
                              : { opacity: 0, y: 10 }
                          }
                          animate={
                            reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }
                          }
                          transition={
                            reduceMotion
                              ? { duration: 0.12 }
                              : { duration: 0.35, ease: "easeOut", delay: 0.2 }
                          }
                          className="mt-4 rounded-2xl border border-white/10 bg-black/25
                                   shadow-[0_22px_60px_rgba(0,0,0,0.55)] overflow-hidden"
                        >
                          <div className="p-5">
                            <div className="space-y-3">
                              <DividerRow
                                left="Subtotal"
                                right={formatBRL(order.subtotal)}
                              />

                              {!!order.discount && order.discount > 0 && (
                                <DividerRow
                                  left={order.discountLabel || "Cupom"}
                                  right={`-${formatBRL(order.discount)}`}
                                />
                              )}

                              <DividerRow
                                left="Taxa"
                                right={formatBRL(order.tax)}
                              />
                            </div>

                            <div className="my-5 h-px bg-white/10" />

                            <div className="flex items-center justify-between">
                              <span className="text-[16px] font-semibold text-white">
                                Total
                              </span>
                              <span className="text-[18px] font-semibold text-white">
                                {formatBRL(order.total)}
                              </span>
                            </div>
                          </div>
                        </motion.div>
                      </div>
                    </div>

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent hidden lg:block" />
                  </div>

                  {/* RIGHT */}
                  <div className="relative flex min-w-0 flex-col overflow-auto lg:h-full row-pay">
                    <div className="flex-1 min-w-0 overflow-auto row-pay">
                      <div className="px-5 sm:px-8 pt-8 min-w-0 row-pay">
                        {/* METHOD TABS */}
                        <div className="flex items-center justify-between">
                          <div className="text-[12px] text-white/45">
                            Pagamento
                          </div>

                          {/* Progress mini (inteligência visual) */}
                          <div className="flex items-center gap-3">
                            <div className="hidden sm:flex items-center gap-2 text-[11px] text-white/35">
                              <span>Progresso</span>
                              <span className="text-white/20">•</span>
                              <span className="text-white/55">
                                {method === "card"
                                  ? `${cardValidity.done}/${cardValidity.total}`
                                  : method === "boleto"
                                    ? boletoStep === "generated"
                                      ? "3/3"
                                      : `${boletoValidity.done}/${boletoValidity.total}`
                                    : liveStatus === "approved" ||
                                        pixStep === "success"
                                      ? "3/3"
                                      : pixStep === "qr"
                                        ? "2/3"
                                        : "1/3"}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-[12px] text-white/40">
                              <IconLock className="text-white/35" />
                              <span>Dados Criptografados</span>
                            </div>
                          </div>
                        </div>

                        <div className="mt-3">
                          <div className="h-2 w-full overflow-hidden rounded-full border border-white/10 bg-white/[0.03]">
                            <motion.div
                              initial={false}
                              animate={{
                                width:
                                  method === "card"
                                    ? `${cardValidity.pct}%`
                                    : method === "boleto"
                                      ? boletoStep === "generated"
                                        ? "100%"
                                        : `${boletoValidity.pct}%`
                                      : `${liveStatus === "approved" || pixStep === "success" ? 100 : pixStep === "qr" ? 75 : 45}%`,
                              }}
                              transition={{
                                type: "spring",
                                stiffness: reduceMotion ? 180 : 480,
                                damping: reduceMotion ? 32 : 40,
                              }}
                              className="h-full rounded-full bg-gradient-to-r from-[#2B67FF] to-[#214FC4]"
                            />
                          </div>
                          <div className="mt-1 text-[11px] text-white/35">
                            {method === "card"
                              ? `Complete ${cardValidity.total - cardValidity.done} etapa(s) para finalizar.`
                              : method === "boleto"
                                ? `Complete ${boletoValidity.total - boletoValidity.done} etapa(s) para gerar o boleto.`
                                : liveStatus === "approved" ||
                                    pixStep === "success"
                                  ? "Pagamento confirmado."
                                  : "Gere o Pix e finalize pelo app do banco."}
                          </div>
                        </div>

                        <div className="mt-4 w-full rounded-2xl border border-white/10 bg-black/25 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
                          <div className="grid grid-cols-3 gap-2">
                            {(
                              [
                                {
                                  key: "card",
                                  label: "Card",
                                  icon: <IconCard className="text-white/80" />,
                                },
                                {
                                  key: "pix",
                                  label: "Pix",
                                  icon: (
                                    <PixImg className="h-[18px] w-[18px] opacity-90" />
                                  ),
                                },
                                {
                                  key: "boleto",
                                  label: "Boleto",
                                  icon: (
                                    <BoletoImg className="h-[13px] w-[18px] opacity-90" />
                                  ),
                                },
                              ] as const
                            ).map((m) => {
                              const active = method === m.key;
                              return (
                                <button
                                  key={m.key}
                                  disabled={paymentLockedByStatus}
                                  onClick={() => {
                                    if (paymentLockedByStatus) return;

                                    setMethod(m.key);
                                    setActionState("idle");
                                    clearActionTimer();
                                  }}
                                  className={`relative flex items-center justify-center gap-2 rounded-xl px-3 sm:px-4 py-2 text-[13px] font-semibold transition
    ${
      active
        ? "bg-white/[0.06] text-white border border-[#214FC4]/60 shadow-[0_0_0_2px_rgba(33,79,196,0.18)]"
        : "text-white/55 hover:text-white hover:bg-white/[0.04] border border-white/10"
    }
    ${paymentLockedByStatus ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
                                >
                                  {m.icon}
                                  {m.label}

                                  {active && (
                                    <motion.span
                                      layoutId="method-underline"
                                      className="absolute inset-x-6 -bottom-[1px] h-[2px] rounded-full bg-[#214FC4]"
                                      transition={{
                                        type: "spring",
                                        stiffness: reduceMotion ? 200 : 700,
                                        damping: reduceMotion ? 34 : 42,
                                      }}
                                    />
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="w-full min-w-0 pb-5">
                          <AnimatePresence mode="wait">
                            {showApprovedAny ? (
                              <motion.div
                                key="approved-any"
                                initial={
                                  reduceMotion
                                    ? { opacity: 0 }
                                    : { opacity: 0, y: 10 }
                                }
                                animate={
                                  reduceMotion
                                    ? { opacity: 1 }
                                    : { opacity: 1, y: 0 }
                                }
                                exit={
                                  reduceMotion
                                    ? { opacity: 0 }
                                    : { opacity: 0, y: 10 }
                                }
                                transition={
                                  reduceMotion
                                    ? { duration: 0.12 }
                                    : { duration: 0.25, ease: "easeOut" }
                                }
                                className="mt-6 w-full min-w-0"
                              >
                                <div className="w-full rounded-2xl border border-white/10 bg-black/25 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
                                  <div className="py-3 flex flex-col items-center text-center">
                                    <motion.div
                                      initial={{
                                        opacity: 0,
                                        y: 10,
                                        scale: 0.98,
                                      }}
                                      animate={{ opacity: 1, y: 0, scale: 1 }}
                                      transition={{
                                        duration: 0.28,
                                        ease: "easeOut",
                                      }}
                                      className="text-[18px] font-semibold text-white"
                                    >
                                      Pagamento Aprovado
                                    </motion.div>

                                    <motion.div
                                      initial={{ opacity: 0, scale: 0.92 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      transition={{
                                        duration: 0.35,
                                        ease: "easeOut",
                                        delay: 0.05,
                                      }}
                                      className="mt-6"
                                    >
                                      <div className="relative">
                                        <div className="absolute inset-0 rounded-full bg-emerald-500/12 blur-2xl" />
                                        <div className="relative rounded-full border border-white/10 bg-white/[0.03] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.55)]">
                                          <IconCheckCircleGreen className="h-[170px] w-[170px]" />
                                        </div>
                                      </div>
                                    </motion.div>

                                    <div className="mt-4 max-w-[420px] text-[12px] leading-relaxed text-white/55">
                                      Pagamento confirmado com sucesso. Aguarde estamos te redirecionado...
                                    </div>

                                    {!!liveStatusDetail && (
                                      <div className="mt-3 max-w-[420px] text-[11px] text-white/40">
                                        {liveStatusDetail}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </motion.div>
                            ) : showFailedAny ? (
                              <motion.div
                                key="failed-any"
                                initial={
                                  reduceMotion
                                    ? { opacity: 0 }
                                    : { opacity: 0, y: 10 }
                                }
                                animate={
                                  reduceMotion
                                    ? { opacity: 1 }
                                    : { opacity: 1, y: 0 }
                                }
                                exit={
                                  reduceMotion
                                    ? { opacity: 0 }
                                    : { opacity: 0, y: 10 }
                                }
                                transition={
                                  reduceMotion
                                    ? { duration: 0.12 }
                                    : { duration: 0.25, ease: "easeOut" }
                                }
                                className="mt-6 w-full min-w-0"
                              >
                                <div className="w-full rounded-2xl border border-white/10 bg-black/25 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
                                  <div className="py-3 flex flex-col items-center text-center">
                                    <motion.div
                                      initial={{
                                        opacity: 0,
                                        y: 10,
                                        scale: 0.98,
                                      }}
                                      animate={{ opacity: 1, y: 0, scale: 1 }}
                                      transition={{
                                        duration: 0.28,
                                        ease: "easeOut",
                                      }}
                                      className="text-[18px] font-semibold text-white"
                                    >
                                      {liveStatus === "expired"
                                        ? "Pagamento Expirado"
                                        : liveStatus === "cancelled"
                                          ? "Pagamento Cancelado"
                                          : "Pagamento Recusado"}
                                    </motion.div>

                                    <motion.div
                                      initial={{ opacity: 0, scale: 0.92 }}
                                      animate={{ opacity: 1, scale: 1 }}
                                      transition={{
                                        duration: 0.35,
                                        ease: "easeOut",
                                        delay: 0.05,
                                      }}
                                      className="mt-6"
                                    >
                                      <div className="relative">
                                        {/* ✅ Expirado amarelo / Cancelado e Recusado vermelho */}
                                        <div
                                          className={`absolute inset-0 rounded-full blur-2xl ${
                                            liveStatus === "expired"
                                              ? "bg-amber-500/12"
                                              : "bg-red-500/10"
                                          }`}
                                        />

                                        <div className="relative rounded-full border border-white/10 bg-white/[0.03] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.55)]">
                                          {liveStatus === "expired" ? (
                                            <IconXCircleYellow className="h-[170px] w-[170px] text-amber-400" />
                                          ) : (
                                            <IconXCircleRed className="h-[170px] w-[170px] text-red-400" />
                                          )}
                                        </div>
                                      </div>
                                    </motion.div>

                                    <div className="mt-4 max-w-[380px] text-[12px] leading-relaxed text-white/55">
                                      {liveStatus === "expired"
                                        ? "O pagamento expirou."
                                        : liveStatus === "cancelled"
                                          ? "Este pagamento foi cancelado."
                                          : "O pagamento foi recusado."}{" "}
                                      Você pode fechar esta janela ou tentar
                                      novamente pelo fluxo de pagamento.
                                    </div>

                                    {!!liveStatusDetail && (
                                      <div className="mt-3 max-w-[420px] text-[11px] text-white/40">
                                        {liveStatusDetail}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </motion.div>
                            ) : (
                              <div key="flow-any">
                                {method === "card" && (
                                  <motion.div
                                    key="card"
                                    initial={
                                      reduceMotion
                                        ? { opacity: 0 }
                                        : { opacity: 0, y: 10 }
                                    }
                                    animate={
                                      reduceMotion
                                        ? { opacity: 1 }
                                        : { opacity: 1, y: 0 }
                                    }
                                    exit={
                                      reduceMotion
                                        ? { opacity: 0 }
                                        : { opacity: 0, y: 10 }
                                    }
                                    transition={
                                      reduceMotion
                                        ? { duration: 0.12 }
                                        : { duration: 0.25, ease: "easeOut" }
                                    }
                                    className="mt-6 w-full min-w-0"
                                  >
                                    <Field
                                      ref={emailRef}
                                      label="E-mail"
                                      placeholder="seuemail@exemplo.com"
                                      value={email}
                                      onChange={(v) => {
                                        cardEmailTouchedRef.current = true;
                                        setEmail(v);
                                        if (emailError) setEmailError(null);
                                      }}
                                      onBlur={() => {
                                        const v = String(email || "");
                                        if (
                                          !cardEmailTouchedRef.current &&
                                          !v.trim()
                                        ) {
                                          setEmailError(null);
                                          return;
                                        }
                                        setEmailError(validateEmailField(v));
                                      }}
                                      error={emailError}
                                      type="email"
                                      autoComplete="email"
                                      name="email"
                                      inputClassName=""
                                      shakeSignal={shakeSignal}
                                    />

                                    <div className="mt-4">
                                      <Field
                                        ref={cardNumberRef}
                                        label="Número do Cartão"
                                        placeholder="1234 1234 1234 1234"
                                        value={cardNumber}
                                        onChange={(v) => {
                                          const next = formatCardNumber(v);
                                          setCardNumber(next);

                                          if (cardErrors.cardNumber)
                                            setCardErrors((s) => ({
                                              ...s,
                                              cardNumber: null,
                                            }));

                                          const digits = onlyDigits(next);
                                          const b = detectBrand(digits);
                                          const allowed =
                                            getCardAllowedLengths(b);

                                          const prevLen =
                                            lastCardDigitsLenRef.current;
                                          lastCardDigitsLenRef.current =
                                            digits.length;

                                          const justCompleted =
                                            allowed.includes(digits.length) &&
                                            digits.length > prevLen;

                                          if (
                                            justCompleted &&
                                            luhnCheck(digits)
                                          ) {
                                            window.setTimeout(
                                              () => expRef.current?.focus(),
                                              40,
                                            );
                                          }
                                        }}
                                        onBlur={() => validateCardFields()}
                                        error={cardErrors.cardNumber || null}
                                        insideRight={
                                          <BrandMark
                                            brand={brand}
                                            cardDigits={cardDigits}
                                          />
                                        }
                                        inputClassName="pr-[116px]"
                                        autoComplete="cc-number"
                                        name="cc-number"
                                        inputMode="numeric"
                                        shakeSignal={shakeSignal}
                                      />
                                    </div>

                                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                                      <Field
                                        ref={expRef}
                                        label="Data de Vencimento"
                                        placeholder="MM / AA"
                                        value={exp}
                                        onChange={(v) => {
                                          const next = formatExpiry(v);
                                          setExp(next);

                                          if (cardErrors.exp)
                                            setCardErrors((s) => ({
                                              ...s,
                                              exp: null,
                                            }));

                                          const d = onlyDigits(next);
                                          const prev =
                                            lastExpDigitsLenRef.current;
                                          lastExpDigitsLenRef.current =
                                            d.length;

                                          if (
                                            d.length === 4 &&
                                            d.length > prev
                                          ) {
                                            window.setTimeout(
                                              () => cvcRef.current?.focus(),
                                              40,
                                            );
                                          }
                                        }}
                                        onBlur={() => validateCardFields()}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter")
                                            validateCardFields();
                                        }}
                                        error={cardErrors.exp || null}
                                        autoComplete="cc-exp"
                                        name="cc-exp"
                                        inputMode="numeric"
                                        shakeSignal={shakeSignal}
                                      />

                                      <Field
                                        ref={cvcRef}
                                        label="Código de Segurança"
                                        placeholder={
                                          brand === "amex" ? "4 dígitos" : "CVC"
                                        }
                                        value={cvc}
                                        onChange={(v) => {
                                          const next = formatCvc(v, brand);
                                          setCvc(next);

                                          if (cardErrors.cvc)
                                            setCardErrors((s) => ({
                                              ...s,
                                              cvc: null,
                                            }));

                                          const expected =
                                            brand === "amex" ? 4 : 3;
                                          if (
                                            onlyDigits(next).length === expected
                                          ) {
                                            window.setTimeout(
                                              () =>
                                                holderNameRef.current?.focus(),
                                              40,
                                            );
                                          }
                                        }}
                                        onBlur={() => validateCardFields()}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter")
                                            validateCardFields();
                                        }}
                                        error={cardErrors.cvc || null}
                                        autoComplete="cc-csc"
                                        name="cc-csc"
                                        inputMode="numeric"
                                        maxLength={brand === "amex" ? 4 : 3}
                                        shakeSignal={shakeSignal}
                                      />
                                    </div>

                                    <div className="mt-4">
                                      <Field
                                        ref={holderNameRef}
                                        label="Nome Completo"
                                        placeholder="Maria Silva"
                                        value={holderName}
                                        onChange={(v) => {
                                          setHolderName(v);
                                          if (holderNameError)
                                            setHolderNameError(null);
                                        }}
                                        onBlur={() => {
                                          const n = holderName
                                            .trim()
                                            .replace(/\s+/g, " ");
                                          setHolderNameError(
                                            n.length >= 3
                                              ? null
                                              : "Digite o nome completo do titular.",
                                          );
                                        }}
                                        error={holderNameError}
                                        autoComplete="cc-name"
                                        name="cc-name"
                                        shakeSignal={shakeSignal}
                                      />
                                    </div>

                                    <div className="mt-4">
                                      <Select
                                        label="Pais"
                                        value={country}
                                        options={COUNTRIES}
                                        onChange={(v) =>
                                          setCountry(v as CountryKey)
                                        }
                                        maxMenuWidth={520}
                                        maxMenuHeight={240}
                                      />
                                    </div>

                                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[0.45fr_1fr]">
                                      <Field
                                        ref={zipRef}
                                        label="Código Postal"
                                        placeholder={zipPlaceholder(country)}
                                        value={zip}
                                        onChange={(v) => {
                                          setZip(
                                            normalizeZipForDisplay(country, v),
                                          );
                                          if (zipError) setZipError(null);
                                          setCityLocked(false);

                                          if (isZipComplete(country, v)) {
                                            window.setTimeout(
                                              () => addressRef.current?.focus(),
                                              40,
                                            );
                                          }
                                        }}
                                        onBlur={handleZipBlur}
                                        error={zipError}
                                        insideRight={
                                          zipLoading ? <SpinnerInInput /> : null
                                        }
                                        inputClassName="pr-[20px]"
                                        inputMode="numeric"
                                        shakeSignal={shakeSignal}
                                      />
                                      <Field
                                        ref={addressRef}
                                        label="Endereço de Cobrança"
                                        placeholder={
                                          country === "Brasil"
                                            ? "Rua, número, bairro"
                                            : "Street address"
                                        }
                                        value={address}
                                        onChange={setAddress}
                                        error={addressError}
                                        autoComplete="street-address"
                                        name="address"
                                        shakeSignal={shakeSignal}
                                      />
                                    </div>

                                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                                      <Select
                                        label="Estado / Região"
                                        value={stateUF}
                                        options={REGIONS}
                                        onChange={setStateUF}
                                        className="md:max-w-[420px]"
                                        maxMenuWidth={420}
                                        maxMenuHeight={200}
                                        right={
                                          stateAutoHint ? (
                                            <span className="text-[11px] text-white/35">
                                              {stateAutoHint}
                                            </span>
                                          ) : undefined
                                        }
                                      />
                                      <Field
                                        label="Cidade"
                                        placeholder="City"
                                        value={city}
                                        onChange={setCity}
                                        error={cityError}
                                        disabled={cityLocked}
                                        right={
                                          cityLocked ? (
                                            <span className="text-[11px] text-white/35">
                                              Auto
                                            </span>
                                          ) : (
                                            <span className="text-[11px] text-white/35">
                                              Manual
                                            </span>
                                          )
                                        }
                                        inputClassName={
                                          cityLocked ? "cursor-not-allowed" : ""
                                        }
                                        autoComplete="address-level2"
                                        name="city"
                                        shakeSignal={shakeSignal}
                                      />
                                    </div>

                                    <div className="mt-4">
                                      <Field
                                        ref={cpfRef}
                                        label="CPF"
                                        placeholder="000.000.000-00"
                                        value={cpf}
                                        onChange={(v) => {
                                          setCpf(formatCPF(v));
                                          if (cardCpfError)
                                            setCardCpfError(null);
                                        }}
                                        onBlur={() =>
                                          setCardCpfError(validateCpfField(cpf))
                                        }
                                        error={cardCpfError}
                                        inputMode="numeric"
                                        autoComplete="off"
                                        name="cpf"
                                        shakeSignal={shakeSignal}
                                      />
                                    </div>
                                  </motion.div>
                                )}

                                {method === "pix" && (
                                  <motion.div
                                    key="pix"
                                    initial={
                                      reduceMotion
                                        ? { opacity: 0 }
                                        : { opacity: 0, y: 10 }
                                    }
                                    animate={
                                      reduceMotion
                                        ? { opacity: 1 }
                                        : { opacity: 1, y: 0 }
                                    }
                                    exit={
                                      reduceMotion
                                        ? { opacity: 0 }
                                        : { opacity: 0, y: 10 }
                                    }
                                    transition={
                                      reduceMotion
                                        ? { duration: 0.12 }
                                        : { duration: 0.25, ease: "easeOut" }
                                    }
                                    className="mt-6 w-full min-w-0"
                                  >
                                    <div className="w-full rounded-2xl border border-white/10 bg-black/25 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
                                      {showPixSuccess ? (
                                        <div className="py-3 flex flex-col items-center text-center">
                                          <motion.div
                                            initial={{
                                              opacity: 0,
                                              y: 10,
                                              scale: 0.98,
                                            }}
                                            animate={{
                                              opacity: 1,
                                              y: 0,
                                              scale: 1,
                                            }}
                                            transition={{
                                              duration: 0.28,
                                              ease: "easeOut",
                                            }}
                                            className="text-[18px] font-semibold text-white"
                                          >
                                            Pagamento Aprovado
                                          </motion.div>

                                          <motion.div
                                            initial={{
                                              opacity: 0,
                                              scale: 0.92,
                                            }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{
                                              duration: 0.35,
                                              ease: "easeOut",
                                              delay: 0.05,
                                            }}
                                            className="mt-6"
                                          >
                                            <div className="relative">
                                              <div className="absolute inset-0 rounded-full bg-emerald-500/12 blur-2xl" />
                                              <div className="relative rounded-full border border-white/10 bg-white/[0.03] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.55)]">
                                                <IconCheckCircleGreen className="h-[170px] w-[170px]" />
                                              </div>
                                            </div>
                                          </motion.div>

                                          <div className="mt-4 max-w-[420px] text-[12px] leading-relaxed text-white/55">
                                            Pagamento confirmado com sucesso.
                                            Aguarde estamos te redirecionado...
                                          </div>

                                          {!!liveStatusDetail && (
                                            <div className="mt-3 max-w-[420px] text-[11px] text-white/40">
                                              {liveStatusDetail}
                                            </div>
                                          )}
                                        </div>
                                      ) : showPixQrFailed ? (
                                        <div className="py-3 flex flex-col items-center text-center">
                                          <motion.div
                                            initial={{
                                              opacity: 0,
                                              y: 10,
                                              scale: 0.98,
                                            }}
                                            animate={{
                                              opacity: 1,
                                              y: 0,
                                              scale: 1,
                                            }}
                                            transition={{
                                              duration: 0.28,
                                              ease: "easeOut",
                                            }}
                                            className="text-[18px] font-semibold text-white"
                                          >
                                            {liveStatus === "expired"
                                              ? "Pagamento Expirado"
                                              : liveStatus === "cancelled"
                                                ? "Pagamento Cancelado"
                                                : "Pagamento Recusado"}
                                          </motion.div>

                                          <motion.div
                                            initial={{
                                              opacity: 0,
                                              scale: 0.92,
                                            }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            transition={{
                                              duration: 0.35,
                                              ease: "easeOut",
                                              delay: 0.05,
                                            }}
                                            className="mt-6"
                                          >
                                            <div className="relative">
                                              <div
                                                className={`absolute inset-0 rounded-full blur-2xl ${
                                                  liveStatus === "expired"
                                                    ? "bg-amber-500/12"
                                                    : "bg-red-500/10"
                                                }`}
                                              />
                                              <div className="relative rounded-full border border-white/10 bg-white/[0.03] p-5 shadow-[0_18px_55px_rgba(0,0,0,0.55)]">
                                                <IconXCircleRed
                                                  className={`h-[170px] w-[170px] ${
                                                    liveStatus === "expired"
                                                      ? "text-amber-400"
                                                      : "text-red-400"
                                                  }`}
                                                />
                                              </div>
                                            </div>
                                          </motion.div>

                                          <div className="mt-4 max-w-[380px] text-[12px] leading-relaxed text-white/55">
                                            {liveStatus === "expired"
                                              ? "O QR Code expirou. Clique em "
                                              : liveStatus === "cancelled"
                                                ? "Este Pix foi cancelado. Clique em "
                                                : "O pagamento foi recusado. Clique em "}
                                            <span className="text-white/80 font-semibold">
                                              Tentar novamente
                                            </span>{" "}
                                            para gerar um novo Pix.
                                          </div>

                                          {!!liveStatusDetail && (
                                            <div className="mt-3 max-w-[420px] text-[11px] text-white/40">
                                              {liveStatusDetail}
                                            </div>
                                          )}
                                        </div>
                                      ) : (
                                        <>
                                          <div className="flex items-start justify-between gap-4">
                                            <div>
                                              <div className="text-[14px] font-semibold text-white">
                                                Pagamento via Pix
                                              </div>
                                              <div className="mt-1 text-[12px] text-white/45">
                                                Confirme seus dados e pague no
                                                app do seu banco.
                                              </div>

                                              <div className="mt-2 text-[11px] text-white/45">
                                                <span className="text-white/35">
                                                  Email:
                                                </span>{" "}
                                                <span className="text-white/30 border-white/10 bg-white/[0.03] p-1 rounded-md">
                                                  {discordEmail
                                                    ? discordEmail
                                                    : "Carregando…"}
                                                </span>
                                              </div>

                                              {!!pixErrors.email && (
                                                <div className="mt-1 text-[11px] text-red-400/90">
                                                  {pixErrors.email}
                                                </div>
                                              )}
                                            </div>

                                            <div className="flex h-10 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
                                              <PixImg className="h-5 w-5 opacity-90" />
                                            </div>
                                          </div>

                                          {pixStep === "form" ? (
                                            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                                              <Field
                                                ref={pixNameRef}
                                                label="Nome completo"
                                                placeholder="Maria Silva"
                                                value={pixName}
                                                onChange={(v) => {
                                                  setPixName(v);
                                                  if (pixNameError)
                                                    setPixNameError(null);
                                                }}
                                                onBlur={() => {
                                                  const n = pixName
                                                    .trim()
                                                    .replace(/\s+/g, " ");
                                                  setPixNameError(
                                                    n.length >= 3
                                                      ? null
                                                      : "Digite seu nome completo.",
                                                  );
                                                }}
                                                error={pixNameError}
                                                autoComplete="name"
                                                name="pix-name"
                                                shakeSignal={shakeSignal}
                                              />

                                              <Field
                                                ref={pixCpfRef}
                                                label="CPF"
                                                placeholder="000.000.000-00"
                                                value={pixCpf}
                                                onChange={(v) => {
                                                  setPixCpf(formatCPF(v));
                                                  if (pixCpfError)
                                                    setPixCpfError(null);
                                                }}
                                                onBlur={() =>
                                                  setPixCpfError(
                                                    validateCpfField(pixCpf),
                                                  )
                                                }
                                                error={pixCpfError}
                                                inputMode="numeric"
                                                autoComplete="off"
                                                name="pix-cpf"
                                                shakeSignal={shakeSignal}
                                              />
                                            </div>
                                          ) : (
                                            <div className="mt-5">
                                              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                                <motion.div
                                                  className="relative aspect-square w-full overflow-hidden rounded-xl border border-white/10"
                                                  initial={{
                                                    scale: 0.99,
                                                    opacity: 0.85,
                                                  }}
                                                  animate={{
                                                    scale: 1,
                                                    opacity: 1,
                                                  }}
                                                  transition={{
                                                    type: "spring",
                                                    stiffness: reduceMotion
                                                      ? 160
                                                      : 520,
                                                    damping: reduceMotion
                                                      ? 30
                                                      : 36,
                                                  }}
                                                >
                                                  {pixQrBase64 ? (
                                                    <img
                                                      src={`data:image/png;base64,${pixQrBase64}`}
                                                      alt="QR Code Pix"
                                                      className="absolute inset-0 h-full w-full object-cover"
                                                      draggable={false}
                                                    />
                                                  ) : (
                                                    <div className="absolute inset-0 flex items-center justify-center text-[12px] text-white/50">
                                                      QR Code indisponível
                                                    </div>
                                                  )}

                                                  {actionState ===
                                                    "loading" && (
                                                    <div className="absolute inset-0 flex items-center justify-center">
                                                      <div className="border border-white/10 bg-black/50 px-4 py-2 text-[12px] text-white/80 shadow-[0_18px_55px_rgba(0,0,0,0.55)]">
                                                        Consultando…
                                                      </div>
                                                    </div>
                                                  )}
                                                </motion.div>
                                              </div>

                                              <div className="mt-3 relative h-[44px] w-full rounded-xl border border-white/10 bg-white/[0.03] shadow-[0_12px_40px_rgba(0,0,0,0.55)]">
                                                <input
                                                  readOnly
                                                  value={
                                                    pixCode ||
                                                    "Código Pix indisponível"
                                                  }
                                                  className="h-full w-full bg-transparent pl-3 pr-[68px] text-[12px] text-white/85 outline-none"
                                                />

                                                <div className="absolute right-1 top-1/2 -translate-y-1/2">
                                                  <motion.button
                                                    key={pixCopyPulse}
                                                    type="button"
                                                    onClick={copyPix}
                                                    disabled={!pixCode}
                                                    whileTap={
                                                      !pixCode
                                                        ? undefined
                                                        : { scale: 0.96 }
                                                    }
                                                    initial={{ scale: 1 }}
                                                    animate={
                                                      pixCopied
                                                        ? {
                                                            scale: [1, 1.06, 1],
                                                          }
                                                        : { scale: 1 }
                                                    }
                                                    transition={{
                                                      duration: 0.28,
                                                      ease: "easeOut",
                                                    }}
                                                    className={`relative h-[36px] w-[44px] overflow-hidden
                            rounded-lg border bg-white/[0.03]
                            inline-flex items-center justify-center transition
                            ${
                              pixCopied
                                ? "border-[#2B67FF]/50 shadow-[0_14px_45px_rgba(43,103,255,0.25)]"
                                : "border-white/10 hover:bg-white/[0.06]"
                            }
                            ${!pixCode ? "opacity-50 cursor-not-allowed" : ""}`}
                                                    aria-label="Copiar código Pix"
                                                  >
                                                    <AnimatePresence>
                                                      {pixCopied && (
                                                        <motion.span
                                                          initial={{
                                                            opacity: 0.0,
                                                            scale: 0.55,
                                                          }}
                                                          animate={{
                                                            opacity: 0.35,
                                                            scale: 1.4,
                                                          }}
                                                          exit={{
                                                            opacity: 0,
                                                            scale: 1.6,
                                                          }}
                                                          transition={{
                                                            duration: 0.45,
                                                            ease: "easeOut",
                                                          }}
                                                          className="pointer-events-none absolute inset-0 rounded-full bg-[#2B67FF]/30"
                                                        />
                                                      )}
                                                    </AnimatePresence>

                                                    <IconCopy
                                                      className={`h-4 w-4 transition ${
                                                        pixCopied
                                                          ? "text-[#2B67FF]"
                                                          : "text-white/70"
                                                      }`}
                                                    />
                                                  </motion.button>

                                                  <AnimatePresence>
                                                    {pixCopied && (
                                                      <motion.div
                                                        initial={{
                                                          opacity: 0,
                                                          y: 8,
                                                          scale: 0.98,
                                                        }}
                                                        animate={{
                                                          opacity: 1,
                                                          y: 0,
                                                          scale: 1,
                                                        }}
                                                        exit={{
                                                          opacity: 0,
                                                          y: 8,
                                                          scale: 0.98,
                                                        }}
                                                        transition={{
                                                          duration: 0.18,
                                                          ease: "easeOut",
                                                        }}
                                                        className="absolute -top-8.5 -right-2.5 rounded-lg border border-white/10 bg-black/70
                                px-2.5 py-1 text-[11px] text-white/85 shadow-[0_18px_55px_rgba(0,0,0,0.55)] backdrop-blur-xl"
                                                      >
                                                        Copiado
                                                      </motion.div>
                                                    )}
                                                  </AnimatePresence>
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>
                                  </motion.div>
                                )}

                                {method === "boleto" && (
                                  <motion.div
                                    key="boleto"
                                    initial={
                                      reduceMotion
                                        ? { opacity: 0 }
                                        : { opacity: 0, y: 10 }
                                    }
                                    animate={
                                      reduceMotion
                                        ? { opacity: 1 }
                                        : { opacity: 1, y: 0 }
                                    }
                                    exit={
                                      reduceMotion
                                        ? { opacity: 0 }
                                        : { opacity: 0, y: 10 }
                                    }
                                    transition={
                                      reduceMotion
                                        ? { duration: 0.12 }
                                        : { duration: 0.25, ease: "easeOut" }
                                    }
                                    className="mt-6 w-full min-w-0"
                                  >
                                    <div className="w-full rounded-2xl border border-white/10 bg-black/25 p-5 shadow-[0_18px_50px_rgba(0,0,0,0.55)]">
                                      <div className="flex items-start justify-between gap-4">
                                        <div>
                                          <div className="text-[14px] font-semibold text-white">
                                            Pagamento via Boleto
                                          </div>
                                          <div className="mt-1 text-[12px] text-white/45">
                                            Informe seu email para receber o
                                            boleto. Compensação em até{" "}
                                            <span className="text-white/70">
                                              2 dias úteis
                                            </span>
                                            .
                                          </div>
                                        </div>
                                        <div className="flex h-10 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
                                          <BoletoImg className="h-[14px] w-[22px] opacity-90" />
                                        </div>
                                      </div>

                                      {/* TELA DE CONFIRMAÇÃO (mostra quando já existe boletoPaymentId) */}
                                      {boletoStep === "generated" ? (
                                        <>
                                          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                            <div className="flex items-start justify-between gap-3">
                                              <div>
                                                <div className="text-[14px] font-semibold text-white/90">
                                                  Confirmação
                                                </div>
                                                <div className="mt-1 text-[12px] text-white/45">
                                                  Seu boleto foi gerado e
                                                  enviado. Compensação em até{" "}
                                                  <span className="text-white/70">
                                                    2 dias úteis
                                                  </span>
                                                  .
                                                </div>
                                              </div>
                                              <div className="flex h-9 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
                                                <BoletoImg className="h-[13px] w-[20px] opacity-90" />
                                              </div>
                                            </div>

                                            {/* Mantive seu bloco de confirmação original, inteiro */}
                                            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                                              <div className="text-[12px] font-semibold text-white/85">
                                                Boleto enviado
                                                {!!boletoTicketUrl && (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      window.open(
                                                        boletoTicketUrl,
                                                        "_blank",
                                                        "noopener,noreferrer",
                                                      )
                                                    }
                                                    className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] font-semibold text-white/80 hover:bg-white/[0.06] transition"
                                                  >
                                                    Abrir boleto
                                                  </button>
                                                )}
                                                {!!boletoBarcode && (
                                                  <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                                    <div className="text-[11px] text-white/45">
                                                      Linha digitável
                                                    </div>
                                                    <div className="mt-1 text-[12px] text-white/85 break-all">
                                                      {safeText(
                                                        boletoBarcode,
                                                        "Linha digitável indisponível",
                                                      )}
                                                    </div>

                                                    <button
                                                      type="button"
                                                      onClick={() =>
                                                        safeClipboardWrite(
                                                          boletoBarcode,
                                                        )
                                                      }
                                                      className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] font-semibold text-white/80 hover:bg-white/[0.06] transition"
                                                    >
                                                      Copiar linha digitável
                                                    </button>
                                                  </div>
                                                )}
                                              </div>

                                              <div className="mt-1 text-[12px] text-white/45">
                                                Enviamos para:{" "}
                                                <span className="text-white/80">
                                                  {boletoSentToEmail ||
                                                    boletoEmail}
                                                </span>
                                              </div>

                                              <div className="mt-2 text-[11px] text-white/45">
                                                <span className="text-white/35">
                                                  ID:
                                                </span>{" "}
                                                <span className="text-white/80">
                                                  {boletoPaymentId}
                                                </span>
                                              </div>

                                              <div className="mt-2 text-[11px] text-white/35">
                                                Dica: confira a caixa de spam e
                                                promoções.
                                              </div>
                                            </div>
                                          </div>

                                          <div className="mt-4 text-[11px] text-white/40">
                                            Ao enviar o boleto, você confirma o
                                            email informado.
                                          </div>
                                        </>
                                      ) : (
                                        <>
                                          {/* FORMULÁRIO (fica igual, só aparece antes de gerar o boleto) */}
                                          <div className="mt-5">
                                            <Field
                                              ref={boletoEmailRef}
                                              label="Email para receber o boleto"
                                              placeholder="seuemail@exemplo.com"
                                              value={
                                                boletoSentToEmail || boletoEmail
                                              }
                                              onChange={(v) => {
                                                setBoletoEmail(v);
                                                if (boletoErrors.email)
                                                  setBoletoErrors((s) => ({
                                                    ...s,
                                                    email: null,
                                                  }));
                                              }}
                                              onBlur={() =>
                                                setBoletoErrors((s) => ({
                                                  ...s,
                                                  email:
                                                    validateEmailField(
                                                      boletoEmail,
                                                    ),
                                                }))
                                              }
                                              error={boletoErrors.email || null}
                                              type="email"
                                              autoComplete="email"
                                              name="boleto-email"
                                              shakeSignal={shakeSignal}
                                            />
                                          </div>

                                          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                                            <Field
                                              ref={boletoNameRef}
                                              label="Nome completo"
                                              placeholder="Maria Silva"
                                              value={boletoName}
                                              onChange={(v) => {
                                                setBoletoName(v);
                                                if (boletoErrors.name)
                                                  setBoletoErrors((s) => ({
                                                    ...s,
                                                    name: null,
                                                  }));
                                              }}
                                              onBlur={() => {
                                                const n = boletoName
                                                  .trim()
                                                  .replace(/\s+/g, " ");
                                                setBoletoErrors((s) => ({
                                                  ...s,
                                                  name:
                                                    n.length >= 3
                                                      ? null
                                                      : "Digite seu nome completo.",
                                                }));
                                              }}
                                              error={boletoErrors.name || null}
                                              autoComplete="name"
                                              name="boleto-name"
                                              shakeSignal={shakeSignal}
                                            />

                                            <Field
                                              ref={boletoCpfRef}
                                              label="CPF"
                                              placeholder="000.000.000-00"
                                              value={boletoCpf}
                                              onChange={(v) => {
                                                setBoletoCpf(formatCPF(v));
                                                if (boletoErrors.cpf)
                                                  setBoletoErrors((s) => ({
                                                    ...s,
                                                    cpf: null,
                                                  }));
                                              }}
                                              onBlur={() =>
                                                setBoletoErrors((s) => ({
                                                  ...s,
                                                  cpf: validateCpfField(
                                                    boletoCpf,
                                                  ),
                                                }))
                                              }
                                              error={boletoErrors.cpf || null}
                                              inputMode="numeric"
                                              autoComplete="off"
                                              name="boleto-cpf"
                                              shakeSignal={shakeSignal}
                                            />
                                          </div>

                                          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                                            <Field
                                              label="CEP"
                                              placeholder="00000-000"
                                              value={boletoZip}
                                              onChange={(v) => {
                                                setBoletoZip(formatCEP(v));
                                                if (boletoErrors.zip)
                                                  setBoletoErrors((s) => ({
                                                    ...s,
                                                    zip: null,
                                                  }));
                                              }}
                                              onBlur={() =>
                                                lookupBoletoCep(boletoZip)
                                              }
                                              error={boletoErrors.zip || null}
                                              insideRight={
                                                boletoCepLoading ? (
                                                  <SpinnerInInput />
                                                ) : null
                                              }
                                              inputMode="numeric"
                                              name="boleto-cep"
                                              shakeSignal={shakeSignal}
                                            />

                                            <Field
                                              label="Rua"
                                              placeholder="Rua Exemplo"
                                              value={boletoStreetName}
                                              onChange={(v) => {
                                                setBoletoStreetName(v);
                                                if (boletoErrors.street_name)
                                                  setBoletoErrors((s) => ({
                                                    ...s,
                                                    street_name: null,
                                                  }));
                                              }}
                                              onBlur={() => {
                                                setBoletoErrors((s) => ({
                                                  ...s,
                                                  street_name:
                                                    boletoStreetName.trim()
                                                      .length >= 2
                                                      ? null
                                                      : "Rua obrigatória.",
                                                }));
                                              }}
                                              error={
                                                boletoErrors.street_name || null
                                              }
                                              name="boleto-street"
                                              shakeSignal={shakeSignal}
                                            />
                                          </div>

                                          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                                            <Field
                                              label="Número"
                                              placeholder="123"
                                              value={boletoStreetNumber}
                                              onChange={(v) => {
                                                setBoletoStreetNumber(v);
                                                if (boletoErrors.street_number)
                                                  setBoletoErrors((s) => ({
                                                    ...s,
                                                    street_number: null,
                                                  }));
                                              }}
                                              onBlur={() => {
                                                setBoletoErrors((s) => ({
                                                  ...s,
                                                  street_number:
                                                    boletoStreetNumber.trim()
                                                      .length
                                                      ? null
                                                      : "Número obrigatório.",
                                                }));
                                              }}
                                              error={
                                                boletoErrors.street_number ||
                                                null
                                              }
                                              name="boleto-number"
                                              shakeSignal={shakeSignal}
                                            />

                                            <Field
                                              label="Bairro"
                                              placeholder="Centro"
                                              value={boletoNeighborhood}
                                              onChange={(v) => {
                                                setBoletoNeighborhood(v);
                                                if (boletoErrors.neighborhood)
                                                  setBoletoErrors((s) => ({
                                                    ...s,
                                                    neighborhood: null,
                                                  }));
                                              }}
                                              onBlur={() => {
                                                setBoletoErrors((s) => ({
                                                  ...s,
                                                  neighborhood:
                                                    boletoNeighborhood.trim()
                                                      .length >= 2
                                                      ? null
                                                      : "Bairro obrigatório.",
                                                }));
                                              }}
                                              error={
                                                boletoErrors.neighborhood ||
                                                null
                                              }
                                              name="boleto-neighborhood"
                                              shakeSignal={shakeSignal}
                                            />
                                          </div>

                                          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                                            <Field
                                              label="Cidade"
                                              placeholder="São Paulo"
                                              value={boletoCity}
                                              onChange={(v) => {
                                                setBoletoCity(v);
                                                if (boletoErrors.city)
                                                  setBoletoErrors((s) => ({
                                                    ...s,
                                                    city: null,
                                                  }));
                                              }}
                                              onBlur={() => {
                                                setBoletoErrors((s) => ({
                                                  ...s,
                                                  city:
                                                    boletoCity.trim().length >=
                                                    2
                                                      ? null
                                                      : "Cidade obrigatória.",
                                                }));
                                              }}
                                              error={boletoErrors.city || null}
                                              name="boleto-city"
                                              shakeSignal={shakeSignal}
                                            />

                                            <Select
                                              label="UF"
                                              value={boletoUF}
                                              options={UF_CODES}
                                              onChange={(v) => {
                                                setBoletoUF(v);
                                                if (boletoErrors.federal_unit)
                                                  setBoletoErrors((s) => ({
                                                    ...s,
                                                    federal_unit: null,
                                                  }));
                                              }}
                                              maxMenuWidth={220}
                                              maxMenuHeight={240}
                                            />
                                          </div>

                                          <div className="mt-4 text-[11px] text-white/40">
                                            Ao enviar o boleto, você confirma o
                                            email informado.
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    </div>

                    {/* FOOTER FIXO */}
                    <div
                      ref={footerRef}
                      className="bg-transparent sticky bottom-0 z-10 px-5 sm:px-8 pb-6"
                    >
                      <div className="rounded-2xl border border-white/10 bg-black p-5 shadow-[0_18px_50px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
                        <div className="space-y-2 ">
                          <DividerRow
                            left="Subtotal"
                            right={formatBRL(order.subtotal)}
                          />

                          {!!order.discount && order.discount > 0 && (
                            <DividerRow
                              left={order.discountLabel || "Cupom"}
                              right={`-${formatBRL(order.discount)}`}
                            />
                          )}

                          <DividerRow
                            left="Total"
                            right={formatBRL(order.total)}
                          />
                        </div>

                        <motion.button
                          whileHover={
                            primaryBtnDisabled ? undefined : { y: -1 }
                          }
                          whileTap={
                            primaryBtnDisabled ? undefined : { scale: 0.985 }
                          }
                          onClick={handlePrimaryAction}
                          disabled={primaryBtnDisabledResolved}
                          className={`mt-5 w-full rounded-xl py-3.5 text-[13px] font-semibold 
                                   bg-gradient-to-b from-[#2B67FF] to-[#214FC4]
                                   text-white shadow-[0_18px_60px_rgba(33,79,196,0.35)]
                                   hover:brightness-110 transition
                                   relative flex items-center justify-center
                                   ${primaryBtnDisabledResolved ? "opacity-70 cursor-not-allowed" : ""}`}
                        >
                          <span className="pointer-events-none inline-flex items-center gap-2">
                            {actionState === "loading" && <SpinnerMini />}
                            {primaryBtnLabelResolved}
                          </span>

                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/85">
                            <IconLock className="text-white/85" />
                          </span>
                        </motion.button>

<div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[11px] text-white/35">
  <span>Powered by WyzeBank</span>
  <span className="text-white/20">•</span>

  <a
    href="https://atlasbot.com.br/faq/termos-de-uso"
    className="hover:text-white/60 transition cursor-pointer"
    target="_blank"
    rel="noopener noreferrer"
  >
    Termos
  </a>

  <span className="text-white/20">•</span>

  <a
    href="https://atlasbot.com.br/faq/política-de-privacidade"
    className="hover:text-white/60 transition cursor-pointer"
    target="_blank"
    rel="noopener noreferrer"
  >
    Privacidade
  </a>
</div>
                      </div>
                    </div>

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent hidden lg:block" />
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
