import { bijoyFixtures, type ConversionFixture } from "./bijoy.fixtures";

/**
 * SutonnyMJ shares Bijoy Classic's byte layout (see
 * `encodings/sutonny/index.ts`), so it shares Bijoy's fixtures rather than
 * keeping a parallel set that could drift.
 *
 * The previous contents of this file were expectations derived from the
 * provisional `encodings/sutonny/map.ts` — internally consistent with an
 * invented table and therefore wrong about real SutonnyMJ text. Running the
 * Bijoy corpus through the `sutonny` id is the parity check; the structural
 * half of it lives in `sutonnyParity.test.ts`.
 */
export const sutonnyFixtures: ConversionFixture[] = bijoyFixtures;
