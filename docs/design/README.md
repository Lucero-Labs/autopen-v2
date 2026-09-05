# docs/design

One design document per non-trivial change, written before the code. Sibling to
`research/` (what we found out); this directory holds *how* a specific piece
gets built.

Name files after the subject: `seal.md`. Keep one document per change; when a
change is split, split the document.

A design document answers, in this order:

1. **What the change asks for**, in one paragraph, citing its issue and the
   RESULT-001 section it derives from. Do not restate either at length.
2. **The decisions the issue leaves open**, and the option chosen for each,
   with the reason. A decision the issue already made is cited, not re-argued.
3. **The types and module boundaries**, as code sketches. Which package, which
   exports, what the port looks like if there is one.
4. **What fails closed**, and how — the exact error or refusal for each thing
   that cannot be determined (STYLES.md §6.2).
5. **How it is tested**, including what a byte-equality or never-log test
   asserts where §7.2 or §8.1 applies.
6. **What is deliberately out of scope**, so the reviewer knows the omission
   was seen.

Two pages is usual. If it runs past four, the change is probably two changes.

A design document is not edited after its code merges; a later change gets a
dated addendum at the bottom, the way `research/RESULT-001-ADDENDUM.md` treats
its parent.
