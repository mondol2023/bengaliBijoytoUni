import type { Metadata } from "next";
import { OcrWorkspace } from "@/components/ocr/OcrWorkspace";

export const metadata: Metadata = {
  title: "Text from images — Convert2Uni",
  description:
    "Read Bengali text out of pictures inside a PDF or Word file, in your browser, line by line next to the image it came from.",
};

export default function OcrPage() {
  return <OcrWorkspace />;
}
