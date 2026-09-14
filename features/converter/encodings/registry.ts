import type { EncodingDefinition } from "./types";
import { bijoyEncoding } from "./bijoy";
import { sutonnyEncoding } from "./sutonny";
import { alphaAnsiEncoding } from "./alphaAnsi";

const registry = new Map<string, EncodingDefinition>();

/** Registers a new legacy encoding. Adding a font later is just this call. */
export function registerEncoding(definition: EncodingDefinition): void {
  registry.set(definition.id, definition);
}

export function getEncoding(id: string): EncodingDefinition | undefined {
  return registry.get(id);
}

export function listEncodings(): EncodingDefinition[] {
  return Array.from(registry.values());
}

registerEncoding(bijoyEncoding);
registerEncoding(sutonnyEncoding);
registerEncoding(alphaAnsiEncoding);
