import React from "react";
import SuspencionItens from "../../../components/front-end/SuspensionItens";

export default function Page() {
  return (
    <SuspencionItens
      userName={undefined}
      supportHref="/support"
      supportCtaLabel="Solicitar revisão da suspensão"
      caseId="3489032499459342-143"
      statusLabel="Suspenso"
      etaLabel="Até 24–72h"
    />
  );
}