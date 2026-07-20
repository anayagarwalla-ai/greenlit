import type { Metadata } from "next";
import { ApprovalReceipt } from "@/components/approval-receipt";

export const metadata: Metadata = {
  title: "Approval record MP-2048-APR",
  robots: { index: false, follow: false, nocache: true },
};

export default function ReceiptPage() {
  return <ApprovalReceipt />;
}

