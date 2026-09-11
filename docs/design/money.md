# Money

## 1 · What this asks for

STYLES §7.1 requires money to be an integer count of the minor unit and says the
rounding policy for derived figures is "written down once and applied
everywhere". Neither exists yet: there is no money type in the repo, and every
figure in `docs/product/` — monto, cuota, costo total, saldo de capital,
intereses compensatorios, punitorios, total a reclamar — is money. RESULT-001
§2.5 sketches `type Minor = bigint` for this, illustration only.

This document covers the primitive and exact allocation. It deliberately stops
short of interest derivation; §6 says why.

## 2 · Decisions

### 2.1 Not in `core` — a new `packages/money`

`core` is the signing and evidence core, and a document-signing core needs no
money at all. RESULT-001 §2.4 places derivations on the product side of the
boundary: *"Liquidación is credit-specific; many instruments have none."*
Putting a credit primitive in `core` would breach the boundary that document
draws.

`rules-pagare-ar` is the wrong home too — money is used by any credit product,
not by the Argentine pagaré rule set specifically.

So: `packages/money`, zero dependencies, importable by products and by other
packages. Dependency direction is unchanged; `money` imports nothing.

*Alternative considered:* keep it in `core` and accept four packages becoming
three. Rejected because package count is cheaper to carry than a boundary that
has stopped meaning anything.

### 2.2 `bigint`, not `number`

RESULT-001 §2.5 says `bigint`, and the runtime argument is decisive: JavaScript
throws a `TypeError` on `1n + 1`. A float can be *typed* out of a `number`-based
money type but not *kept* out of it at runtime; with `bigint`, the engine
refuses. `number` also carries a cliff at 2^53 centavos, which is remote but not
a thing to reason about at all if it can be removed.

Cost: `bigint` is not JSON-serializable. Serialization is explicit, at the edge,
alongside formatting.

### 2.3 ARS is implied, not carried

`Centavos` is a branded `bigint`, with no currency field. The product is
single-currency. A second currency is a change to this module, not a
configuration of it — which is the honest description and keeps us from
building a currency system nobody has asked for.

### 2.4 Rounding mode is not decided here

Splitting a total into *n* cuotas cannot be exact in general. Two things are
separable:

- **The invariant**, which is decidable now and is not a matter of taste: the
  cuotas must sum to the total, exactly. A residual of one centavo has to land
  somewhere rather than evaporate.
- **The mode** — half-up, half-even, or truncate-and-carry — which has consumer
  and evidentiary consequences in Argentina and is a decision for a named human
  under STYLES §10.1.

`allocate` therefore takes the mode as a required argument. There is no default,
because a default would be a legal decision made by omission.

## 3 · Types

```ts
/** An exact count of centavos. ARS is implied; see design/money.md §2.3. */
export type Centavos = bigint & { readonly __brand: "Centavos" };

/** How a residual centavo is placed when a total does not divide evenly. */
export type RoundingMode = "half-up" | "half-even" | "truncate";

export function centavos(value: bigint): Centavos;
export function add(a: Centavos, b: Centavos): Centavos;
export function subtract(a: Centavos, b: Centavos): Centavos;
export function negate(a: Centavos): Centavos;
export function compare(a: Centavos, b: Centavos): -1 | 0 | 1;

/**
 * Splits `total` into `parts` instalments that sum to `total` exactly.
 *
 * The residual is placed by `mode`; whichever mode is chosen, the sum invariant
 * holds. Throws when `parts` is not a positive integer.
 */
export function allocate(
  total: Centavos,
  parts: number,
  mode: RoundingMode,
): readonly Centavos[];
```

Signed values are permitted: a liquidación nets payments against charges, and a
credit is a negative amount rather than a separate type.

Formatting is not here. `$1.900.000` is a presentation of `190000000n`, rendered
at the edge with `es-AR` conventions (STYLES §7.1). A module that formats
imports this one; this one never formats.

## 4 · What fails closed

- `centavos()` rejects a non-integer. `bigint` makes this structural rather than
  a runtime check, which is the point of choosing it.
- `allocate` throws `InvalidAllocationError` when `parts` is zero, negative, or
  not an integer. It does not return an empty array — a caller asking for zero
  instalments has a bug, and silently agreeing hides it.
- `allocate` has no default mode. Omitting it is a type error.
- Mixing a `Centavos` with a raw `number` is a `TypeError` from the engine.

## 5 · How it is tested

- **The sum invariant, exhaustively over a table**: for every mode, and for
  totals and part-counts including the awkward ones (`100n / 3`, `1n / 7`,
  negative totals, `parts === 1`), `allocate(...).reduce(add) === total`. This
  is the property that makes the type worth having; a test that only checks
  individual cuotas would pass while centavos leak.
- **Residual placement is asserted per mode**, not just the sum — otherwise all
  three modes are indistinguishable to the suite.
- `allocate` throws for `parts` of `0`, `-1` and `2.5`.
- Runtime-agnostic: no timers, no Node types (STYLES §10).

## 6 · Out of scope

**Interest derivation — cuota from monto, TNA and plazo.** Two blockers, one
of them newly found:

1. The rounding mode is undecided (§2.4).
2. `docs/product/` shows `$1.900.000` at TNA 78,0 % over 24 cuotas with a cuota
   of `$118.700` and a costo total of `$2.848.800`. Those figures are internally
   consistent — `118.700 × 24 = 2.848.800` — but they are not French
   amortisation at that rate, which gives `$158.456`. They imply a flat 25 %/yr.
   Whether the prototype's rate, its cuota, or its stated system is the
   placeholder is a question for the design's author, and the derivation cannot
   be written until it is answered.

Also out: formatting, currency conversion, and the liquidación itself — capital,
compensatorios, punitorios — which is a derivation and waits on the same answer.
