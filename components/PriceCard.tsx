"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Pay from "./payment/pay";
import SafePay from "@/components/SafePay";

type Plan = "starter" | "pro" | "premium";
type Billing = "monthly" | "annual";

const PRICES = {
  monthly: {
    starter: { card: "R$ 14,90 / mês", modal: "R$ 14,90", sub: "BRL / mês" },
    pro: { card: "R$ 19,90 / mês", modal: "R$ 19,90", sub: "BRL / mês" },
    premium: { card: "R$ 24,99 / mês", modal: "R$ 24,99", sub: "BRL / mês" },
  },
  annual: {
    starter: { card: "R$ 12,49 / mês", modal: "R$ 12,49", sub: "BRL / mês (anual)" },
    pro: { card: "R$ 16,59 / mês", modal: "R$ 16,59", sub: "BRL / mês (anual)" },
    premium: { card: "R$ 20,79 / mês", modal: "R$ 20,79", sub: "BRL / mês (anual)" },
  },
};

//  NOVO: fonte única do checkout (nome + descrição do PriceCards)
const PLAN_META: Record<Plan, { title: string; description: string }> = {
  starter: { title: "Starter", description: "Apenas 1 bot com sistemas limitados" },
  pro: { title: "Pro", description: "Apenas 2 bots com sistemas limitados" },
  premium: { title: "Premium", description: "Bots e sistemas ilimitados + AtlasIA" },
};

export default function PriceCard() {
  const [selected, setSelected] = useState<Plan>("pro");
  const [open, setOpen] = useState(false);
  const [billing, setBilling] = useState<Billing>("monthly");

  //  modal do checkout
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const handleProceed = () => {
    console.log("Prosseguir com o plano:", selected, billing);
  };

  return (
    <>
      {/* CARDS SELECT (FORA DO MODAL) */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="mt-10 space-y-4"
      >
        <MiniPlan
          title="Starter"
          price={PRICES[billing].starter.card}
          description="Apenas 1 bot com sistemas limitados"
          selected={selected === "starter"}
          onSelect={() => setSelected("starter")}
          onMore={() => {
            setSelected("starter");
            setOpen(true);
          }}
        />

        <MiniPlan
          title="Pro"
          price={PRICES[billing].pro.card}
          description="Apenas 2 bots com sistemas limitados"
          selected={selected === "pro"}
          onSelect={() => setSelected("pro")}
          onMore={() => {
            setSelected("pro");
            setOpen(true);
          }}
        />

        <>
          <MiniPlan
            title="Premium"
            price={PRICES[billing].premium.card}
            description="Bots e sistemas ilimitados + AtlasIA"
            selected={selected === "premium"}
            highlight
            onSelect={() => setSelected("premium")}
            onMore={() => {
              setSelected("premium");
              setOpen(true);
            }}
          />

          <motion.button
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            onClick={() => {
              handleProceed();
              setCheckoutOpen(true);
            }}
            className="w-full rounded-xl py-3 text-sm font-semibold
                       bg-gradient-to-b from-[#214FC4] to-[#214FC4]/90
                       text-white shadow-lg
                       hover:brightness-95 active:scale-[0.98] transition"
          >
            Concluir e Prosseguir
          </motion.button>
        </>
      </motion.div>

<SafePay
  open={checkoutOpen}
  onClose={() => setCheckoutOpen(false)}
  plan={selected}
/>

      {/*  CHECKOUT MODAL (CENTRO DA TELA) */}
      <Pay
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        plan={selected}
        billing={billing}
        planTitle={PLAN_META[selected].title}
        planDescription={PLAN_META[selected].description}
      />

      {/* OVERLAY + MODAL (APENAS VER BENEFÍCIOS) */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[999] flex items-center justify-center
                       bg-black/70 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-[1250px] max-w-[96vw]
                         rounded-2xl border border-white/10
                         bg-gradient-to-b from-white/[0.06] to-white/[0.02]
                         backdrop-blur-xl
                         px-12 pt-12 pb-10
                         shadow-2xl"
            >
              {/* HEADER */}
              <div className="mb-12 text-center">
                <h3 className="text-[24px] font-medium text-white">
                  Faça upgrade do seu plano
                </h3>

                <div
                  className="mt-4 inline-flex items-center rounded-full
                                bg-[#151515] border border-white/10 p-1"
                >
                  <button
                    onClick={() => setBilling("monthly")}
                    className={`rounded-full px-4 py-1 text-xs ${
                      billing === "monthly"
                        ? "bg-white/[0.08] text-white"
                        : "text-white/50"
                    }`}
                  >
                    Mensal
                  </button>
                  <button
                    onClick={() => setBilling("annual")}
                    className={`px-4 py-1 text-xs ${
                      billing === "annual"
                        ? "bg-white/[0.08] text-white rounded-full"
                        : "text-white/50"
                    }`}
                  >
                    Anual
                  </button>
                </div>
              </div>

              {/* GRID */}
              <div className="grid grid-cols-3 gap-8">
                <ModalPlan
                  title="Starter"
                  price={PRICES[billing].starter.modal}
                  subtitle={PRICES[billing].starter.sub}
                  description="Para começar com automações básicas"
                  active={selected === "starter"}
                  onConfirm={() => {
                    setSelected("starter");
                    setOpen(false);
                  }}
                  features={[
                    "7 dias grátis",
                    "1 bot por conta",
                    "Plugins essenciais",
                    "Configuração manual",
                    "Dashboard básico",
                  ]}
                />

                <ModalPlan
                  title="Pro"
                  price={PRICES[billing].pro.modal}
                  subtitle={PRICES[billing].pro.sub}
                  description="Desbloqueie a experiência completa"
                  active={selected === "pro"}
                  onConfirm={() => {
                    setSelected("pro");
                    setOpen(false);
                  }}
                  features={[
                    "7 dias grátis",
                    "Múltiplos bots",
                    "Sistema completo de plugins",
                    "Automação por eventos",
                    "Logs detalhados",
                    "Prioridade em novos recursos",
                  ]}
                />

                <ModalPlan
                  title="Premium"
                  price={PRICES[billing].premium.modal}
                  subtitle={PRICES[billing].premium.sub}
                  highlight
                  description="Aumente sua produtividade ao máximo"
                  active={selected === "premium"}
                  onConfirm={() => {
                    setSelected("premium");
                    setOpen(false);
                  }}
                  features={[
                    "7 dias grátis",
                    "Bots ilimitados",
                    "Plugins premium exclusivos",
                    "Automações condicionais",
                    "Integrações externas",
                    "Suporte dedicado",
                  ]}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* MINI PLAN */
/* ------------------------------------------------------------------ */

function MiniPlan({
  title,
  price,
  description,
  selected,
  highlight,
  onSelect,
  onMore,
}: any) {
  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-2xl border
        bg-gradient-to-b from-white/[0.06] to-white/[0.02]
        backdrop-blur-xl px-6 py-5 shadow-2xl transition-all
        ${
          selected
            ? "border-[#214FC4]"
            : "border-white/10 hover:border-white/20"
        }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <div className="mt-1">
            <div
              className={`h-4 w-4 rounded-full border flex items-center justify-center
                ${selected ? "border-[#214FC4]" : "border-white/30"}`}
            >
              {selected && (
                <div className="h-2 w-2 rounded-full bg-[#214FC4]" />
              )}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="text-xs text-white/50">{description}</p>
            <p className="mt-2 text-sm text-white">{price}</p>
            <p className="text-[11px] text-white/40">7 dias grátis</p>
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onMore();
          }}
          className="rounded-lg border border-white/20
                     bg-[#151515] px-4 py-2
                     text-sm text-white/80
                     hover:bg-white/[0.06] hover:border-white/30 transition"
        >
          Ver bêneficios
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MODAL PLAN */
/* ------------------------------------------------------------------ */

function ModalPlan({
  title,
  price,
  subtitle,
  description,
  features,
  active,
  highlight,
  onConfirm,
}: any) {
  return (
    <div
      className={`relative flex flex-col rounded-xl
        border border-white/10 bg-[#151515]
        px-7 pt-7 pb-6
        shadow-[0_20px_50px_rgba(0,0,0,0.6)]
        transition-all
        ${active ? "ring-1 ring-white/20" : "hover:bg-[#1b1b1b]"}`}
    >
      {highlight && (
        <span
          className="absolute top-4 right-4 text-[11px]
                         rounded-full bg-white/[0.08]
                         border border-white/10
                         px-3 py-1 text-white"
        >
          Popular
        </span>
      )}

      <p className="text-lg font-semibold text-white">{title}</p>

      <div className="mt-3 flex items-end gap-1">
        <span className="text-4xl font-semibold text-white">{price}</span>
        <span className="mb-1 text-xs text-white/50">{subtitle}</span>
      </div>

      <p className="mt-3 text-sm text-white/70">{description}</p>

      <button
        onClick={onConfirm}
        className="mt-6 w-full rounded-xl py-2.5 text-sm font-medium
                   bg-gradient-to-b from-[#214FC4] to-[#214FC4]/90
                   text-white shadow-lg
                   hover:brightness-95 active:scale-[0.99] transition"
      >
        Confirmar plano
      </button>

      <ul className="mt-6 space-y-3 text-sm text-white/70">
        {features.map((f: string) => (
          <li key={f} className="flex gap-2">
            <span className="text-white/50">•</span>
            {f}
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-4 text-xs text-white/40 underline cursor-pointer">
        Limites aplicáveis
      </div>
    </div>
  );
}
