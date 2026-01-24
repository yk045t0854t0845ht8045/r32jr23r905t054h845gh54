"use client";

import dynamic from "next/dynamic";
import React, { useMemo } from "react";
import ErrorBoundary from "./ErrorBoundary";

type Plan = "starter" | "pro" | "premium";
type Billing = "monthly" | "annual";
type Method = "card" | "pix" | "boleto";

type SafePayProps = {
  open: boolean;
  onClose: () => void;
  plan: any;
  billing?: any;
  method?: any;
  [key: string]: any;
};

function safeToText(v: any) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    const s = JSON.stringify(v);
    return s === "{}" ? "" : s;
  } catch {
    return "";
  }
}

function normalizePlan(plan: any): Plan | null {
  if (plan === "starter" || plan === "pro" || plan === "premium") return plan;
  if (plan && typeof plan === "object") {
    const cand =
      plan.plan ??
      plan.id ??
      plan.slug ??
      plan.key ??
      plan.name ??
      plan.value ??
      null;

    if (cand === "starter" || cand === "pro" || cand === "premium") return cand;
  }

  return null;
}

function normalizeBilling(b: any): Billing | null {
  if (b === "monthly" || b === "annual") return b;
  if (b && typeof b === "object") {
    const cand = b.billing ?? b.id ?? b.value ?? null;
    if (cand === "monthly" || cand === "annual") return cand;
  }
  return null;
}

function normalizeMethod(m: any): Method | null {
  if (m === "card" || m === "pix" || m === "boleto") return m;
  if (m && typeof m === "object") {
    const cand = m.method ?? m.id ?? m.value ?? null;
    if (cand === "card" || cand === "pix" || cand === "boleto") return cand;
  }
  return null;
}

type PayComponentProps = {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  billing?: Billing | any;
  method?: Method | any;
  [key: string]: any;
};

const PaySafeLoaded = dynamic<PayComponentProps>(
  async () => {
    const mod: any = await import("../components/payment/pay");
    const Comp = mod?.default ?? mod?.Pay ?? null;

    if (typeof Comp !== "function") {
      return function NullPay() {
        return null;
      };
    }

    return Comp as React.ComponentType<PayComponentProps>;
  },
  { ssr: false },
);

export default function SafePay(props: SafePayProps) {
  const { open, onClose, plan, billing, method, ...rest } = props;

  //  evita render/execução desnecessária
  if (!open) return null;

  const normalized = useMemo(() => {
    return {
      plan: normalizePlan(plan),
      billing: normalizeBilling(billing),
      method: normalizeMethod(method),
      rawPlanText: safeToText(plan),
    };
  }, [plan, billing, method]);

  if (!normalized.plan) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
          <div className="text-base font-semibold">Checkout indisponível</div>
          <div className="mt-2 text-sm text-neutral-600">
            Não consegui identificar o plano selecionado. Isso evita a página
            quebrar.
          </div>

          <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
            plano recebido:{" "}
            <span className="font-mono">
              {normalized.rawPlanText || "(vazio)"}
            </span>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-xl border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary
      resetKey={`${open}-${normalized.plan}-${normalized.billing ?? ""}-${normalized.method ?? ""}`}
      fallback={
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
            <div className="text-base font-semibold">
              O checkout falhou, mas a página não caiu
            </div>
            <div className="mt-2 text-sm text-neutral-600">
              Feche e tente novamente. Se persistir, recarregue a página.
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={onClose}
                className="rounded-xl border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      }
      onError={(e) => console.error("[SafePay] error:", e)}
    >
      <PaySafeLoaded
        open={open}
        onClose={onClose}
        plan={normalized.plan}
        billing={normalized.billing ?? rest.billing}
        method={normalized.method ?? rest.method}
        {...rest}
      />
    </ErrorBoundary>
  );
}
