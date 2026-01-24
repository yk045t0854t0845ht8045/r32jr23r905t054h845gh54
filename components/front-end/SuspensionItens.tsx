"use client";

import React, { useMemo, useState, useId, useEffect, useRef } from "react";
import {
  motion,
  AnimatePresence,
  useReducedMotion,
  type Transition,
} from "framer-motion";
import {
  Headphones,
  Timer,
  ChevronDown,
  UploadCloud,
  FileText,
  CheckCircle2,
  X,
} from "lucide-react";

type Props = {
  userName?: string;

  supportCtaLabel?: string;
  supportHref?: string;

  caseId?: string;
  statusLabel?: string;
  etaLabel?: string;

  supportCardClassName?: string;
  supportCardStyle?: React.CSSProperties;
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const v = bytes / Math.pow(k, i);
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function safeStr(v: any) {
  return typeof v === "string" ? v : "";
}

export default function SuspencionItens({
  userName,
  supportCtaLabel = "Solicitar revisão da suspensão",
  caseId = "—",
  statusLabel = "Em revisão",
  etaLabel = "Até 24–72h",
  supportCardClassName = "sm:translate-x-10",
  supportCardStyle,
}: Props) {
  const reduceMotion = useReducedMotion();
  const rid = useId();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [openReview, setOpenReview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [topic, setTopic] = useState<string>("suporte");
  const [requestType, setRequestType] = useState<string>("revisao_suspensao");
  const [category, setCategory] = useState<string>("");
  const [impact, setImpact] = useState<string>("");
  const [subject, setSubject] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [errors, setErrors] = useState<{
    category?: string | null;
    impact?: string | null;
    subject?: string | null;
    description?: string | null;
    attachments?: string | null;
  }>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const desktopPanelRef = useRef<HTMLDivElement | null>(null);
  const desktopMountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openReview) return;

    setSubmitted(false);
    setSubmitting(false);
    setErrors({});
    setLoading(true);

    const t = setTimeout(() => setLoading(false), 900);
    return () => clearTimeout(t);
  }, [openReview]);

  const resetAndClose = () => {
    setOpenReview(false);

    setTopic("suporte");
    setRequestType("revisao_suspensao");
    setCategory("");
    setImpact("");
    setSubject("");
    setDescription("");
    setAttachments([]);
    setErrors({});
    setSubmitted(false);
    setSubmitting(false);
    setDragActive(false);
    setLoading(false);
  };

  const openReviewFlow = () => {
    setOpenReview(true);

    if (typeof window !== "undefined") {
      requestAnimationFrame(() => {
        desktopMountRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

  useEffect(() => {
    if (!openReview) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;

      if (typeof window !== "undefined") {
        const isMobile = window.matchMedia("(max-width: 639px)").matches;
        if (isMobile) resetAndClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };

  }, [openReview]);

  const faqs = useMemo(
    () => [
      {
        q: "Por que minha conta foi suspensa?",
        a: "Por segurança e conformidade, nem sempre exibimos o motivo específico. Você pode solicitar uma revisão para que nossa equipe verifique seu caso.",
      },
      {
        q: "Quanto tempo demora para voltar?",
        a: "Normalmente de 24 a 72 horas. Em alguns casos, pode levar mais tempo dependendo da análise.",
      },
      {
        q: "Posso usar o bot durante a suspensão?",
        a: "Não. O acesso fica bloqueado até a conclusão da análise.",
      },
      {
        q: "O que devo enviar para agilizar a revisão?",
        a: "Informe seu protocolo, o que aconteceu (com datas/horários aproximados) e anexos relevantes (comprovantes, prints, etc.).",
      },
      {
        q: "Se for engano, a conta é reativada?",
        a: "Sim. Se confirmarmos que foi um bloqueio indevido, o acesso é restaurado.",
      },
    ],
    []
  );

  const COLLAPSED_H = 64;

  const PANEL_MAXH = "min(calc(100svh - 24px), 760px)";
  const DESKTOP_SCROLL_MAXH = `calc(${PANEL_MAXH} - 68px)`;

  const validate = () => {
    const next: typeof errors = {};
    const subj = subject.trim();
    const desc = description.trim();

    if (!category) next.category = "Selecione uma opção.";
    if (!impact) next.impact = "Selecione uma opção.";
    if (subj.length < 3) next.subject = "Informe um assunto.";
    if (desc.length < 10) next.description = "Descreva melhor o ocorrido.";

    const totalSize = attachments.reduce((acc, f) => acc + (f?.size || 0), 0);
    const MAX_FILES = 8;
    const MAX_TOTAL = 20 * 1024 * 1024;
    if (attachments.length > MAX_FILES) next.attachments = "Máximo de 8 arquivos.";
    else if (totalSize > MAX_TOTAL) next.attachments = "Tamanho total máximo: 20MB.";

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const mergeFiles = (incoming: File[]) => {
    const clean = incoming.filter(Boolean);
    if (!clean.length) return;

    setAttachments((prev) => {
      const map = new Map<string, File>();
      for (const f of prev) map.set(`${f.name}-${f.size}-${f.lastModified}`, f);
      for (const f of clean) map.set(`${f.name}-${f.size}-${f.lastModified}`, f);
      return Array.from(map.values()).slice(0, 12);
    });
  };

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    mergeFiles(files);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files || []);
    mergeFiles(files);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!validate()) return;

    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 900));
    setSubmitting(false);
    setSubmitted(true);
  };

  const selectClass =
    "h-10 w-full appearance-none rounded-md border border-white/10 bg-[#0b0f18] " +
    "px-3 pr-9 text-[12px] text-white/85 outline-none focus:border-white/25 " +
    "shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";
  const optionClass = "bg-[#0b0f18] text-white";

  const fadeIn: Transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.28, ease: [0.22, 1, 0.36, 1] };

  const panelSpring: Transition = reduceMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 260, damping: 28, mass: 0.9 };

  return (
    <div className="relative min-h-[100svh] w-full overflow-hidden bg-black">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(255,255,255,0.04),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(33,79,196,0.12),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_55%_45%,rgba(255,255,255,0.02),transparent_60%)]" />
      </div>

      <div className="relative mx-auto w-full max-w-6xl px-4 py-8 sm:px-5 sm:py-10 sm:py-14">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >

          <div className="mt-3 mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="relative h-20 w-20 overflow-hidden select-none">
              <img
                src="/cdn/icons/lock.png"
                alt="Suspensão"
                className="h-full w-full object-cover"
                draggable={false}
              />
            </div>
          </div>

          <h1 className="text-2xl font-semibold text-white sm:text-3xl">
            Seu acesso foi suspenso
          </h1>

          <p className="mt-2 max-w-2xl text-sm text-white/60">
            {userName && <span className="text-white/80">{userName}, </span>}
            o acesso foi temporariamente bloqueado por segurança e conformidade.
          </p>

          <AnimatePresence initial={false} mode="wait">
            {!openReview ? (
              <motion.div
                key="faq-state"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={fadeIn}
              >

                <div className="mt-5 flex flex-wrap gap-2 text-xs text-white/55">
                  <span className="rounded-full bg-white/[0.04] px-3 py-1">
                    {statusLabel}
                  </span>
                  <span className="rounded-full bg-white/[0.04] px-3 py-1 inline-flex items-center gap-1">
                    <Timer className="h-3.5 w-3.5" />
                    {etaLabel}
                  </span>
                  <span className="rounded-full bg-white/[0.04] px-3 py-1">
                    Protocolo: {caseId}
                  </span>
                </div>

                <div className="mt-10 max-w-2xl">
                  <p className="text-[20px] font-semibold text-white">Perguntas Frequentes</p>

                  <div className="mt-3 space-y-2">
                    {faqs.map((item, idx) => {
                      const open = openFaq === idx;
                      const id = `faq-${rid}-${idx}`;

                      return (
                        <div key={item.q} className="border-b border-white/10 pb-2">
                          <button
                            onClick={() => setOpenFaq(open ? null : idx)}
                            className="flex w-full items-center justify-between py-2 text-left"
                            aria-expanded={open}
                            aria-controls={id}
                          >
                            <span className="text-sm text-white/65">{item.q}</span>
                            <motion.span
                              animate={{ rotate: open ? 180 : 0 }}
                              transition={{ duration: 0.22 }}
                              className="text-white/60"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </motion.span>
                          </button>

                          <AnimatePresence>
                            {open && (
                              <motion.div
                                id={id}
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <p className="pb-2 text-sm text-white/60">{item.a}</p>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>

                  <AnimatePresence initial={false}>
                    {!openReview && (
                      <motion.div
                        key="cta-under-faq-desktop"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={fadeIn}
                        className="mt-7 hidden sm:block"
                      >
                        <motion.button
                          whileHover={reduceMotion ? undefined : { y: -1 }}
                          whileTap={reduceMotion ? undefined : { scale: 0.985 }}
                          onClick={openReviewFlow}
                          className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-semibold
                                     bg-gradient-to-b from-[#2B67FF] to-[#214FC4]
                                     text-white shadow-[0_18px_60px_rgba(33,79,196,0.35)]
                                     hover:brightness-110 transition"
                        >
                          <Headphones className="h-4 w-4" />
                          {supportCtaLabel}
                        </motion.button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="mt-9 sm:hidden">
                  <motion.button
                    whileHover={reduceMotion ? undefined : { y: -1 }}
                    whileTap={reduceMotion ? undefined : { scale: 0.985 }}
                    onClick={openReviewFlow}
                    className="w-full rounded-xl py-3 text-[13px] font-semibold
                               bg-gradient-to-b from-[#2B67FF] to-[#214FC4]
                               text-white shadow-[0_18px_60px_rgba(33,79,196,0.35)]
                               hover:brightness-110 transition
                               flex items-center justify-center"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Headphones className="h-4 w-4 mb-0.5" />
                      {supportCtaLabel}
                    </span>
                  </motion.button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="form-state"
                ref={desktopMountRef}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={panelSpring}
                className="mt-7 max-w-2xl"
              >
                <div
                  ref={desktopPanelRef}
                  className="w-full overflow-hidden rounded-2xl
                             bg-white/[0.02] backdrop-blur-sm shadow-[0_25px_80px_rgba(0,0,0,0.55)]
                             border border-white/10"
                  style={{ maxHeight: PANEL_MAXH }}
                >
                  <div className="p-5 relative">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-white/85 truncate">
                          Solicitação de revisão
                        </div>
                        <div className="mt-0.5 text-[11px] text-white/45">
                          Protocolo: <span className="text-white/70">{caseId}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={resetAndClose}
                        className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1
                                   text-[11px] text-white/60 hover:text-white hover:bg-white/[0.05] transition"
                        aria-label="Fechar"
                      >
                        <X className="h-3.5 w-3.5" />
                        Fechar
                      </button>
                    </div>

                    <div
                      className="mt-4 overflow-y-auto overscroll-contain pr-1 pb-2"
                      style={{
                        maxHeight: DESKTOP_SCROLL_MAXH,
                        scrollbarWidth: "none",
                        msOverflowStyle: "none",
                        WebkitOverflowScrolling: "touch",
                      }}
                    >
                      {loading ? (
                        <div className="space-y-3">
                          <div className="h-10 rounded-md bg-white/10 animate-pulse" />
                          <div className="h-10 rounded-md bg-white/10 animate-pulse" />
                          <div className="h-10 rounded-md bg-white/10 animate-pulse" />
                          <div className="h-10 rounded-md bg-white/10 animate-pulse" />
                          <div className="h-24 rounded-md bg-white/10 animate-pulse" />
                          <div className="h-16 rounded-md bg-white/10 animate-pulse" />
                          <div className="h-11 rounded-md bg-white/10 animate-pulse" />
                        </div>
                      ) : submitted ? (
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
                              <CheckCircle2 className="h-5 w-5 text-white/70" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-[13px] font-semibold text-white/85">
                                Solicitação enviada
                              </div>
                              <div className="mt-1 text-[11px] leading-relaxed text-white/50">
                                Recebemos sua solicitação. Nossa equipe vai analisar e retornar assim
                                que houver uma atualização.
                              </div>

                              <motion.button
                                whileHover={reduceMotion ? undefined : { y: -1 }}
                                whileTap={reduceMotion ? undefined : { scale: 0.985 }}
                                onClick={resetAndClose}
                                className="mt-3 w-full rounded-xl py-2.5 text-[12px] font-medium
                                           border border-white/10 bg-white/[0.03]
                                           text-white/75 hover:bg-white/[0.06] hover:text-white transition"
                              >
                                Voltar
                              </motion.button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <div className="text-[11px] font-medium text-white/55">
                              Tipo de atendimento
                            </div>
                            <div className="relative">
                              <select
                                value={topic}
                                onChange={(e) => setTopic(e.target.value)}
                                className={selectClass}
                                style={{ colorScheme: "dark" }}
                              >
                                <option className={optionClass} value="suporte">
                                  Suporte
                                </option>
                                <option className={optionClass} value="conta">
                                  Conta
                                </option>
                                <option className={optionClass} value="seguranca">
                                  Segurança
                                </option>
                                <option className={optionClass} value="pagamentos">
                                  Pagamentos
                                </option>
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="text-[11px] font-medium text-white/55">
                              O que você deseja solicitar?
                            </div>
                            <div className="relative">
                              <select
                                value={requestType}
                                onChange={(e) => setRequestType(e.target.value)}
                                className={selectClass}
                                style={{ colorScheme: "dark" }}
                              >
                                <option className={optionClass} value="revisao_suspensao">
                                  Revisão de suspensão
                                </option>
                                <option className={optionClass} value="apelacao">
                                  Apelação (discorda do bloqueio)
                                </option>
                                <option className={optionClass} value="verificacao">
                                  Verificação de conta
                                </option>
                                <option className={optionClass} value="outro">
                                  Outro
                                </option>
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="text-[11px] font-medium text-white/55">
                              Selecione o cenário mais próximo
                            </div>
                            <div className="relative">
                              <select
                                value={category}
                                onChange={(e) => {
                                  setCategory(e.target.value);
                                  if (errors.category) setErrors((s) => ({ ...s, category: null }));
                                }}
                                className={[
                                  selectClass,
                                  errors.category ? "border-red-500/50" : "",
                                ].join(" ")}
                                style={{ colorScheme: "dark" }}
                              >
                                <option className={optionClass} value="">
                                  Selecione…
                                </option>
                                <option className={optionClass} value="nao_sei">
                                  Não sei o motivo
                                </option>
                                <option className={optionClass} value="atividade_incomum">
                                  Atividade incomum / acesso diferente
                                </option>
                                <option className={optionClass} value="verificacao">
                                  Pedir verificação
                                </option>
                                <option className={optionClass} value="pagamento">
                                  Cobrança / estorno / risco financeiro
                                </option>
                                <option className={optionClass} value="possivel_violacao">
                                  Possível violação (quero esclarecer)
                                </option>
                                <option className={optionClass} value="outro">
                                  Outro
                                </option>
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/45" />
                            </div>
                            {!!errors.category && (
                              <div className="text-[11px] text-red-400/90">{errors.category}</div>
                            )}
                          </div>

                          <div className="space-y-1">
                            <div className="text-[11px] font-medium text-white/55">Assunto</div>
                            <input
                              value={subject}
                              onChange={(e) => {
                                setSubject(e.target.value);
                                if (errors.subject) setErrors((s) => ({ ...s, subject: null }));
                              }}
                              placeholder="Ex.: Suspensão sem motivo aparente"
                              className={`h-10 w-full rounded-md border bg-white/[0.03] px-3
                                         text-[12px] text-white/80 outline-none placeholder:text-white/35
                                         focus:border-white/20
                                         ${errors.subject ? "border-red-500/50" : "border-white/10"}`}
                            />
                            {!!errors.subject && (
                              <div className="text-[11px] text-red-400/90">{errors.subject}</div>
                            )}
                          </div>

                          <div className="space-y-1">
                            <div className="text-[11px] font-medium text-white/55">Descrição</div>
                            <textarea
                              rows={4}
                              value={description}
                              onChange={(e) => {
                                setDescription(e.target.value);
                                if (errors.description)
                                  setErrors((s) => ({ ...s, description: null }));
                              }}
                              placeholder="Conte o que aconteceu antes da suspensão: o que você estava fazendo, quando ocorreu, se recebeu algum aviso, mudanças recentes (senha, dispositivo, localização), etc."
                              className={`w-full rounded-md border bg-white/[0.03] p-3
                                         text-[12px] text-white/80 outline-none resize-none
                                         placeholder:text-white/35 focus:border-white/20
                                         ${errors.description ? "border-red-500/50" : "border-white/10"}`}
                            />
                            <div className="flex items-center justify-between">
                              {!!errors.description ? (
                                <div className="text-[11px] text-red-400/90">{errors.description}</div>
                              ) : (
                                <div className="text-[11px] text-white/40">
                                  Dica: inclua datas, horários e prints se tiver.
                                </div>
                              )}
                              <div className="text-[11px] text-white/35">
                                {Math.min(description.length, 5000)}/5000
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="text-[11px] font-medium text-white/55">Anexos (opcional)</div>

                            <div
                              onDragEnter={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDragActive(true);
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDragActive(true);
                              }}
                              onDragLeave={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDragActive(false);
                              }}
                              onDrop={onDrop}
                              className={`rounded-md border bg-white/[0.03] p-3 transition
                                          ${dragActive ? "border-white/25 bg-white/[0.05]" : "border-white/10"}`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[12px] text-white/70">
                                    Adicionar arquivo ou soltar aqui
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-white/35">
                                    PNG, JPG, PDF • até 8 arquivos • total 20MB
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => fileInputRef.current?.click()}
                                  className="shrink-0 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.02]
                                             px-3 py-2 text-[11px] font-semibold text-white/70
                                             hover:bg-white/[0.06] hover:text-white transition"
                                >
                                  <UploadCloud className="h-4 w-4" />
                                  Adicionar
                                </button>

                                <input
                                  ref={fileInputRef}
                                  type="file"
                                  multiple
                                  onChange={onPickFiles}
                                  className="hidden"
                                />
                              </div>

                              {!!errors.attachments && (
                                <div className="mt-2 text-[11px] text-red-400/90">
                                  {errors.attachments}
                                </div>
                              )}

                              {attachments.length > 0 && (
                                <div className="mt-3 space-y-2">
                                  {attachments.slice(0, 8).map((f, idx) => (
                                    <div
                                      key={`${f.name}-${f.size}-${f.lastModified}`}
                                      className="flex items-center gap-3 rounded-md border border-white/10 bg-black/25 px-3 py-2"
                                    >
                                      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/[0.02]">
                                        <FileText className="h-4 w-4 text-white/60" />
                                      </div>

                                      <div className="min-w-0 flex-1">
                                        <div className="truncate text-[12px] text-white/75">
                                          {safeStr(f.name)}
                                        </div>
                                        <div className="text-[11px] text-white/35">
                                          {formatBytes(f.size)}
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() =>
                                          setAttachments((prev) => prev.filter((_, i) => i !== idx))
                                        }
                                        className="rounded-md border border-white/10 bg-white/[0.02] p-2 text-white/55
                                                   hover:bg-white/[0.06] hover:text-white transition"
                                        aria-label="Remover arquivo"
                                      >
                                        <X className="h-4 w-4" />
                                      </button>
                                    </div>
                                  ))}

                                  {attachments.length > 8 && (
                                    <div className="text-[11px] text-white/40">
                                      +{attachments.length - 8} arquivo(s) extra(s) (máximo 8).
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          <motion.button
                            whileHover={reduceMotion ? undefined : { y: -1 }}
                            whileTap={reduceMotion ? undefined : { scale: 0.985 }}
                            onClick={handleSubmit}
                            disabled={submitting}
                            className={`w-full rounded-xl py-2.5 text-[12px] font-medium
                                       bg-gradient-to-b from-[#2B67FF] to-[#214FC4]
                                       text-white shadow-[0_18px_60px_rgba(33,79,196,0.05)]
                                       hover:brightness-110 transition
                                       flex items-center justify-center
                                       ${submitting ? "opacity-80 cursor-not-allowed" : ""}`}
                          >
                            {submitting ? "Enviando..." : "Enviar solicitação"}
                          </motion.button>
                        </div>
                      )}
                    </div>

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/40 to-transparent" />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}
