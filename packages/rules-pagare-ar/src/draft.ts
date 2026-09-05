/**
 * The subject the Argentine pagaré policy reads.
 *
 * Only the fields the rules need. This is not the instrument aggregate and it
 * is not a persistence model — widening it is how a gate quietly becomes a
 * validator for everything.
 */

export type PersonKind = "fisica" | "juridica";

export interface Debtor {
  readonly kind: PersonKind;
  readonly fullName: string;
  readonly nationalId: string;
}

export interface PagareDraft {
  /** Where the instrument is payable. Blank in the prototype, on purpose. */
  readonly lugarDePago?: string | undefined;
  /**
   * Consumer-credit disclosure. Required when the debtor is a natural person;
   * meaningless otherwise, which is why it is a wrapped rule rather than a
   * field-level one.
   */
  readonly integracionDeConsumo?: string | undefined;
  readonly debtor: Debtor;
  /** ISO-8601 date of the first instalment. */
  readonly primerVencimiento?: string | undefined;
}
