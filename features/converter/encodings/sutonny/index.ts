import type { EncodingDefinition } from "../types";
import { sutonnyRules } from "./map";
import { sutonnyPostProcess } from "./rules";

export const sutonnyEncoding: EncodingDefinition = {
  id: "sutonny",
  name: "SutonnyMJ",
  description: "Legacy SutonnyMJ ASCII-keyboard Bengali encoding.",
  maturity: "experimental",
  rules: sutonnyRules,
  postProcess: sutonnyPostProcess,
};
