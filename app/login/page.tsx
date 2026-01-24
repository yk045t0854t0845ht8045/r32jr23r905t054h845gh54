"use client";

import { Inter } from "next/font/google";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/button";
import { useRouter } from "next/navigation";
import DiscordProfile from "@/components/DiscordProfile";
import PriceCard from "@/components/PriceCard";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export default function Page() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailStatus, setEmailStatus] = useState<
    "idle" | "loading" | "valid" | "invalid"
  >("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordText, setShowPasswordText] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [discordUser, setDiscordUser] = useState<any>(null);
  const [step, setStep] = useState<"discord" | "plan">("discord");

  const handleBack = () => {
    if (step === "plan") {
      setStep("discord");
      return;
    }

    router.push("/");
  };

  useEffect(() => {
    const checkAuth = async () => {
      const res = await fetch("/api/me", {
        credentials: "include",
      });

      const data = await res.json();

      if (data.user) {
        setDiscordUser(data.user);
        setLoading(false);
        return;
      }

      setTimeout(() => {
        window.location.href = "/api/auth/discord";
      }, 1500);
    };

    checkAuth();
  }, []);

  useEffect(() => {
    if (!email) {
      setEmailStatus("idle");
      setShowPassword(false);
      setShowPasswordText(false);
      return;
    }

    setEmailStatus("loading");
    setShowPassword(false);

    const timeout = setTimeout(() => {
      const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

      setEmailStatus(isValid ? "valid" : "invalid");
      setShowPassword(isValid);

      if (!isValid) {
        setShowPasswordText(false);
      }
    }, 600);

    return () => clearTimeout(timeout);
  }, [email]);

  return (
    <main
      className={`${inter.variable} flex h-screen w-full overflow-hidden`}
      style={{ fontFamily: "var(--font-inter)" }}
    >
      {/* LEFT SIDE */}
      <section
        className="relative flex flex-1 flex-col justify-between px-14 py-12 text-white"
        style={{
          backgroundImage:
            "url('/cdn/wallpaper/abstract-background-3840x2160-11467.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        <div>
          <img
            src="/cdn/logo/logo.png"
            alt="AtlasBot Logo"
            className="h-10 w-auto"
          />
        </div>

        <div className="max-w-md">
          <h1 className="mb-3 text-2xl leading-snug" style={{ fontWeight: 450 }}>
            Crie bots exclusivos e totalmente personalizados em minutos com a
            AtlasBot
          </h1>

          <p
            className="mb-5 text-sm leading-relaxed text-white/95"
            style={{ fontWeight: 450 }}
          >
            Gerencie e configure seu próprio bot sem precisar programar ou
            contratar desenvolvedores.
          </p>

          <div className="mt-6 text-xs text-white/60 w-[999px]">
            © {new Date().getFullYear()} AtlasBot. Todos os direitos reservados.
          </div>
        </div>
      </section>

      {/* RIGHT SIDE */}
      <section className="relative bg-[#080808] w-[500px] overflow-hidden">
        {/* Back Button */}
        <div className="absolute left-6 top-6 z-10">
          <Button
            className="rounded-[7px] text-[12.5px] border-white/10 bg-black/25 hover:bg-black/15 hover:border-white/10 shadow-[0_22px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl transition-all"
            onClick={handleBack}
            iconLeft={
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            }
          >
            Voltar
          </Button>
        </div>

        {/* CONTENT */}
        <div className="mt-20 px-6 relative z-10">
          <h2 className="mb-1 text-[35px] text-white" style={{ fontWeight: 500 }}>
            Seja bem vindo!
          </h2>

          <p className="mb-6 text-sm text-white/80">
            Faça login e comece a criar, personalizar e gerenciar seus bots com
            total controle e facilidade.
          </p>
        </div>

        {/* LOADER ↔ CONTEÚDO */}
        <AnimatePresence>
          {loading && (
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <motion.div
                className="relative flex items-center justify-center"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
              >
                {/* Glow */}
                <motion.div
                  className="absolute h-28 w-28 rounded-full bg-[#214FC4]/20 blur-3xl"
                  animate={{
                    scale: [1, 1.2, 1],
                    opacity: [0.4, 0.7, 0.4],
                  }}
                  transition={{
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />

                {/* Outer Ring */}
                <motion.div
                  className="h-30 w-30 rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 6,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />

                {/* Inner Spinner */}
                <motion.div
                  className="absolute h-14 w-14 rounded-full border-t-3 border-[#214FC4]/80"
                  animate={{ rotate: -360 }}
                  transition={{
                    duration: 1.4,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {!loading && discordUser && (
          <div className="px-6">
            <AnimatePresence mode="wait">
              {step === "discord" && (
                <DiscordProfile
                  key="discord"
                  user={discordUser}
                  onConfirm={() => setStep("plan")}
                />
              )}

              {step === "plan" && <PriceCard key="plan" />}
            </AnimatePresence>
          </div>
        )}
      </section>
    </main>
  );
}
