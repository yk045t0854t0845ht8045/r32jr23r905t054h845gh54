"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

type DiscordUser = {
  id: string;
  username: string;
  discriminator: string;
  avatar: string;
};

export default function DiscordProfile({
  user,
  onConfirm,
}: {
  user: DiscordUser;
  onConfirm: () => void;
}) {
  const [openSelect, setOpenSelect] = useState(false);
  const [accounts] = useState<DiscordUser[]>([user]);
  const [active, setActive] = useState<DiscordUser>(user);

  const selectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(e.target as Node)) {
        setOpenSelect(false);
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="mt-4 rounded-2xl px-2 py-7 space-y-5 shadow-2xl"
    >
      <div ref={selectRef} className="relative">
        <button onClick={() => setOpenSelect((v) => !v)} className="w-full">
          <div className="flex items-center gap-4 rounded-xl bg-black/25 shadow-[0_22px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl px-4 py-3 border border-white/10 hover:border-white/15 hover:black/65 transition-all shadow-2xl">
            <div className="relative">
              <img
                src={`https://cdn.discordapp.com/avatars/${active.id}/${active.avatar}.png`}
                className="h-9 w-9 rounded-full"
                alt="Discord Avatar"
              />
              <div className="absolute inset-0 rounded-full ring-2 ring-white/10" />
            </div>

            <div className="flex flex-col flex-1 text-left">
              <p className="text-sm font-semibold text-white tracking-tight">
                {active.username}
                <span className="text-white/40 font-normal">
                  #{active.discriminator}
                </span>
              </p>
              <p className="text-xs text-white/50">Conta ativa nesta sessão</p>
            </div>

            <svg
              className={`h-4 w-4 text-white/40 transition-transform ${
                openSelect ? "rotate-180" : ""
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </button>

        <AnimatePresence>
          {openSelect && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.99 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              className="absolute z-30 mt-1.5 w-full rounded-2xl border
                        border-white/10 bg-black/25 shadow-[0_22px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl transition-all p-3"
            >
              <div className="space-y-1">
                {accounts.map((acc, idx) => {
                  const isActive = acc.id === active.id;
                  const stableKey = `${String(acc?.id || "acc")}:${String(
                    acc?.username || "user",
                  )}:${idx}`;

                  return (
                    <button
                      key={stableKey}
                      onClick={() => {
                        setActive(acc);
                        setOpenSelect(false);
                      }}
                      className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5
                        text-left transition-all border
                        ${
                          isActive
                            ? "bg-white/[0.03] border-white/10"
                            : "border-transparent hover:bg-white/[0.06] hover:border-white/20"
                        }`}
                    >
                      <img
                        src={`https://cdn.discordapp.com/avatars/${acc.id}/${acc.avatar}.png`}
                        className="h-8 w-8 rounded-full"
                      />

                      <div className="flex flex-col">
                        <p className="text-sm text-white font-medium leading-tight">
                          {acc.username}
                          <span className="text-white/40 font-normal">
                            #{acc.discriminator}
                          </span>
                        </p>
                        <p className="text-xs text-white/45">
                          {isActive ? "Conta atual" : "Conta disponível"}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="my-3 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

              <button
                onClick={() => {
                  window.location.href = "/api/auth/discord";
                }}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5
                           text-left transition-all border border-transparent
                           hover:bg-white/[0.03] hover:border-white/10"
              >
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full 
                                bg-white/10 text-white/80"
                >
                  ⇄
                </div>
                <div className="flex flex-col">
                  <p className="text-sm text-white font-medium">
                    Trocar de conta
                  </p>
                  <p className="text-xs text-white/45">
                    Conectar outro Discord
                  </p>
                </div>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/25 shadow-[0_22px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl px-5 py-4 space-y-3">
        <p className="text-sm font-medium text-white">Permissões concedidas</p>

        <ul className="space-y-2 text-sm text-white/70">
          <li>• Identificação básica cadastral</li>
          <li>• Endereço de e-mail associado à conta</li>
          <li>• Informações públicas do perfil Discord</li>
          <li>• Uso exclusivo para autenticação e sessão</li>
          <li className="text-white/40">
            • Nenhuma mensagem será enviada ou lida
          </li>
        </ul>
      </div>

      <div className="rounded-xl bg-black/25 shadow-[0_22px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl px-5 py-4 text-[12px] text-white/60 border border-white/10">
        Sessão protegida. Você pode revogar o acesso a qualquer momento nas
        configurações da sua conta Discord.
      </div>

      <button
        className="mt-5 w-full rounded-xl py-3.5 text-[13px] font-semibold 
                                    bg-gradient-to-b from-[#2B67FF] to-[#214FC4]
                                    text-white shadow-[0_18px_60px_rgba(33,79,196,0.35)]
                                    hover:brightness-110 transition
                                    relative flex items-center justify-center 
                                    active:bg-[#214FC4]/90 active:scale-[0.99] transition"
        onClick={onConfirm}
      >
        Confirmar e continuar
      </button>

      <p className="text-center text-[10px] text-white/30 leading-relaxed">
        Ao confirmar, você concorda com todos os{" "}
        <span className="text-white/50 hover:underline cursor-pointer">
          Termos de Serviço
        </span>{" "}
        e a{" "}
        <span className="text-white/50 hover:underline cursor-pointer">
          Política de Privacidade
        </span>
        .
      </p>
    </motion.div>
  );
}
