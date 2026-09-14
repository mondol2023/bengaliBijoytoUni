import type { Metadata } from "next";
import { ComparisonWorkspace } from "@/components/comparison/ComparisonWorkspace";

export const metadata: Metadata = {
  title: "Compare Documents — Convert2Uni",
  description:
    "Compare two texts or documents word-by-word or paragraph-by-paragraph and see similarity, additions, removals, and modifications.",
};

export default function ComparePage() {
  return <ComparisonWorkspace />;
}
