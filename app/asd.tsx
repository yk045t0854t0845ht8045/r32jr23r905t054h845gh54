"use client";

import { useCallback, useState } from "react";
import SafePay from "@/../../components/SafePay";

export default function Page() {
  const [open, setOpen] = useState(true);

  const onClose = useCallback(() => {
    setOpen(false);
  }, []);

  return (
    <>
      <SafePay
        open={open}
        onClose={onClose}
        plan="starter"
        billing="monthly"
        method="pix"
      />

      {!open && (
        <div className="min-h-screen w-full flex items-center justify-center p-6">
          <button
            onClick={() => setOpen(true)}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-white/80 hover:bg-white/[0.06] hover:text-white transition"
          >
            Abrir SafePay
          </button>
        </div>
      )}
    </>
  );
}
