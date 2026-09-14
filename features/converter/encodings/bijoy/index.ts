import type { EncodingDefinition } from "../types";
import { bijoyRules } from "./map";
import { bijoyPostProcess } from "./rules";

export const bijoyEncoding: EncodingDefinition = {
  id: "bijoy",
  name: "Bijoy Classic",
  description: "Legacy Bijoy Classic ASCII-keyboard Bengali encoding.",
  maturity: "experimental",
  rules: bijoyRules,
  postProcess: bijoyPostProcess,
};
