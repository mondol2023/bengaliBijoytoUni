import type { Metadata } from "next";
import { AccountWorkspace } from "@/components/account/AccountWorkspace";

export const metadata: Metadata = {
  title: "Account — Convert2Uni",
  description: "Manage your usage tier and view your recent conversions, comparisons, and document uploads.",
};

export default function AccountPage() {
  return <AccountWorkspace />;
}
