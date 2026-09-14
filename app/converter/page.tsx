import type { Metadata } from "next";
import { ConverterWorkspace } from "@/components/converter/ConverterWorkspace";

export const metadata: Metadata = {
  title: "Text Converter — Convert2Uni",
  description: "Convert legacy Bijoy and SutonnyMJ Bengali text to standards-compliant Unicode.",
};

export default function ConverterPage() {
  return <ConverterWorkspace />;
}
