import { describe, expect, it } from "vitest";
import { InMemoryPolicyRegistry, PolicyGate } from "@autopen/gate";

import { PAGARE_AR_KEY, pagareArPolicy } from "../src/policy.js";
import type { PagareDraft } from "../src/draft.js";

const gate = new PolicyGate<PagareDraft>(
  new InMemoryPolicyRegistry<PagareDraft>().register(PAGARE_AR_KEY, pagareArPolicy),
  { clock: { now: () => new Date("2026-08-21T12:00:00.000Z") } },
);

const draft = (overrides: Partial<PagareDraft> = {}): PagareDraft => ({
  debtor: { kind: "fisica", fullName: "Carla Giménez", nationalId: "38945221" },
  primerVencimiento: "2026-09-10",
  ...overrides,
});

const evaluate = (d: PagareDraft) => gate.evaluate(d, PAGARE_AR_KEY);

describe("pagaré AR policy — the prototype's S1 panel", () => {
  it("blocks the send when both required fields are missing", async () => {
    const verdict = await evaluate(draft());

    expect(verdict.issuable).toBe(false);
    expect(verdict.findings.map((f) => f.ruleId)).toEqual([
      "ar.pagare.lugar-de-pago-requerido",
      "ar.pagare.integracion-de-consumo-requerida",
    ]);
  });

  it("surfaces the operator-facing reasons verbatim", async () => {
    const verdict = await evaluate(draft());

    expect(verdict.findings.map((f) => f.message)).toEqual([
      "Lugar de pago — requerido para la ejecutabilidad del pagaré.",
      "Integración de consumo — obligatoria cuando el deudor es persona física.",
    ]);
  });

  it("points each finding at the field that caused it", async () => {
    const verdict = await evaluate(draft());

    expect(verdict.findings.map((f) => f.path)).toEqual([
      "lugarDePago",
      "integracionDeConsumo",
    ]);
  });

  it("is issuable once both are completed", async () => {
    const verdict = await evaluate(
      draft({
        lugarDePago: "San Justo, Pcia. de Buenos Aires",
        integracionDeConsumo: "Anexo I - Res. Gral. 1060/2025",
      }),
    );

    expect(verdict.issuable).toBe(true);
    expect(verdict.findings).toEqual([]);
  });

  it("still blocks when only the lugar de pago was fixed", async () => {
    const verdict = await evaluate(draft({ lugarDePago: "San Justo" }));

    expect(verdict.issuable).toBe(false);
    expect(verdict.findings.map((f) => f.ruleId)).toEqual([
      "ar.pagare.integracion-de-consumo-requerida",
    ]);
  });
});

describe("consumer disclosure is conditional on the debtor being a natural person", () => {
  it("is not required of a persona jurídica", async () => {
    const verdict = await evaluate(
      draft({
        lugarDePago: "San Justo",
        debtor: { kind: "juridica", fullName: "Transportes SRL", nationalId: "30712345678" },
      }),
    );

    expect(verdict.issuable).toBe(true);
    expect(verdict.findings).toEqual([]);
  });

  it("is required of a persona física", async () => {
    const verdict = await evaluate(draft({ lugarDePago: "San Justo" }));

    expect(verdict.findings.map((f) => f.ruleId)).toContain(
      "ar.pagare.integracion-de-consumo-requerida",
    );
  });
});

describe("first instalment date", () => {
  it("warns without blocking when it is in the past", async () => {
    const verdict = await evaluate(
      draft({
        lugarDePago: "San Justo",
        integracionDeConsumo: "Anexo I",
        primerVencimiento: "2026-01-01",
      }),
    );

    expect(verdict.issuable).toBe(true);
    expect(verdict.findings).toHaveLength(1);
    expect(verdict.findings[0]).toMatchObject({
      ruleId: "ar.pagare.primer-vencimiento-en-el-futuro",
      severity: "advisory",
    });
  });

  it("says nothing when it is in the future", async () => {
    const verdict = await evaluate(
      draft({ lugarDePago: "San Justo", integracionDeConsumo: "Anexo I" }),
    );

    expect(verdict.findings).toEqual([]);
  });

  it("ignores an unparseable date rather than blocking on it", async () => {
    const verdict = await evaluate(
      draft({
        lugarDePago: "San Justo",
        integracionDeConsumo: "Anexo I",
        primerVencimiento: "not-a-date",
      }),
    );

    expect(verdict.issuable).toBe(true);
    expect(verdict.findings).toEqual([]);
  });
});

describe("the verdict is recordable", () => {
  it("names the policy and version that produced it", async () => {
    const verdict = await evaluate(draft());

    expect(verdict.policyId).toBe("ar.pagare.v1");
    expect(verdict.policyVersion).toBe("1.0.0");
    expect(verdict.evaluatedAt).toBe("2026-08-21T12:00:00.000Z");
  });
});
