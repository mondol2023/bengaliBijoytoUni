import type { Metadata } from "next";
import { DocumentUploadWorkspace } from "@/components/documents/DocumentUploadWorkspace";

export const metadata: Metadata = {
  title: "Document Converter — Convert2Uni",
  description:
    "Upload a legacy Bijoy or SutonnyMJ Bengali PDF, DOCX, DOC, or TXT file and convert its text to standards-compliant Unicode.",
};

export default function DocumentsPage() {
  return <DocumentUploadWorkspace />;
}
