import type { EncodingDefinition } from "../types";
import { bijoyRules } from "../bijoy/map";
import { bijoyPostProcess } from "../bijoy/rules";

/**
 * SutonnyMJ is not a separate layout from Bijoy Classic — it is the font
 * Bijoy's ASCII keyboard layout was designed around, which is why
 * `../bijoy/map.ts` calls itself the "Bijoy Classic (SutonnyMJ-family)"
 * table and why the bytes that table was corrected against came from a real
 * SutonnyMJ document (the govt job circular block in
 * `__tests__/bijoy.fixtures.ts`).
 *
 * This entry used to carry its own `./map.ts`, a self-declared provisional
 * table that deliberately assigned *different* legacy keys to the same
 * Bengali glyphs in order to prove the registry could host two independent
 * encodings. That made it a fabricated layout: any real SutonnyMJ document
 * selected as "SutonnyMJ" converted to nonsense, while the same bytes
 * converted correctly if the user happened to pick "Bijoy Classic".
 *
 * So the id and the user-visible name stay — people look for "SutonnyMJ" —
 * but the rules are the Bijoy table by reference, not a copy, so the two can
 * never drift. `__tests__/sutonnyParity.test.ts` asserts exactly that.
 *
 * `./map.ts` and `./rules.ts` are intentionally left in the tree, now
 * unreferenced, until the parity tests have been reviewed against real
 * SutonnyMJ samples; removing them is a separate commit.
 */
export const sutonnyEncoding: EncodingDefinition = {
  id: "sutonny",
  name: "SutonnyMJ",
  description: "Legacy SutonnyMJ Bengali encoding — same byte layout as Bijoy Classic.",
  maturity: "experimental",
  rules: bijoyRules,
  postProcess: bijoyPostProcess,
};
