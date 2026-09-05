import type { Policy, PolicyKey, Rule } from "@autopen/core";
import { definePolicy, onlyWhen, predicate, required } from "@autopen/gate";

import type { PagareDraft } from "./draft.js";

export const PAGARE_AR_KEY: PolicyKey = Object.freeze({
  instrumentType: "pagare-con-garantia-prendaria",
  jurisdiction: "AR",
});

/**
 * Messages are the strings the operator reads, taken verbatim from the
 * prototype's validation panel. They live beside the rule rather than in the
 * UI, so the reason a send is blocked is the reason the rule states.
 */
export const lugarDePagoRequerido: Rule<PagareDraft> = required<PagareDraft>({
  id: "ar.pagare.lugar-de-pago-requerido",
  description: "Lugar de pago — requerido para la ejecutabilidad del pagaré.",
  path: "lugarDePago",
  select: (draft) => draft.lugarDePago,
});

/**
 * Only binds for a natural person, so the obligation is expressed as a
 * condition around the rule instead of a branch inside it. A `juridica` debtor
 * yields no finding at all rather than a passing one.
 */
export const integracionDeConsumoRequerida: Rule<PagareDraft> = onlyWhen<PagareDraft>(
  (draft) => draft.debtor.kind === "fisica",
  required<PagareDraft>({
    id: "ar.pagare.integracion-de-consumo-requerida",
    description: "Integración de consumo — obligatoria cuando el deudor es persona física.",
    path: "integracionDeConsumo",
    select: (draft) => draft.integracionDeConsumo,
  }),
);

/**
 * Advisory, not blocking: a first instalment already in the past is usually a
 * typo, but it does not make the instrument unenforceable — so it warns the
 * operator without stopping the send.
 */
export const primerVencimientoEnElFuturo: Rule<PagareDraft> = predicate<PagareDraft>({
  id: "ar.pagare.primer-vencimiento-en-el-futuro",
  description: "El primer vencimiento es anterior a hoy — revisá la fecha.",
  severity: "advisory",
  path: "primerVencimiento",
  holds: (draft, context) => {
    if (draft.primerVencimiento === undefined) return true;
    const due = Date.parse(draft.primerVencimiento);
    return Number.isNaN(due) ? true : due >= context.now.getTime();
  },
});

/**
 * Bump the version whenever the rule set changes: a stored verdict names the
 * version it was produced under, and that is what makes an old decision
 * explicable later.
 */
export const pagareArPolicy: Policy<PagareDraft> = definePolicy<PagareDraft>({
  id: "ar.pagare.v1",
  version: "1.0.0",
  rules: [lugarDePagoRequerido, integracionDeConsumoRequerida, primerVencimientoEnElFuturo],
});
