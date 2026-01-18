"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  console.error("[app/error] ", error);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-xl font-semibold">Ops! Algo deu errado</div>
      <p className="text-sm text-neutral-600">
        Mas fica tranquilo: a aplicação continua estável. Tente novamente.
      </p>

      <div className="flex gap-2">
        <button
          onClick={() => reset()}
          className="rounded-xl bg-black px-4 py-2 text-sm text-white hover:opacity-90"
        >
          Tentar novamente
        </button>
        <button
          onClick={() => (window.location.href = "/")}
          className="rounded-xl border border-neutral-200 px-4 py-2 text-sm hover:bg-neutral-50"
        >
          Ir para início
        </button>
      </div>
    </div>
  );
}
