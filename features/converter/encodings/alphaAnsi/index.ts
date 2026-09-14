import type { EncodingDefinition } from "../types";
import { alphaAnsiRules } from "./map";
import { alphaAnsiPostProcess } from "./rules";

export const alphaAnsiEncoding: EncodingDefinition = {
  id: "alpha-ansi",
  name: "Legacy ANSI (alphabetic)",
  description:
    "Alphabetic-order legacy Bengali ANSI layout (আ=B, ক=L, া=¡). Seen in older Bangladeshi court and land-office documents; not Bijoy.",
  maturity: "experimental",
  rules: alphaAnsiRules,
  postProcess: alphaAnsiPostProcess,
};
