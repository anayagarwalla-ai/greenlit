import type { Metadata } from "next";
import { ApprovalReceipt } from "@/components/approval-receipt";

export const metadata: Metadata = { title: "Approval record", robots: { index: false, follow: false, noarchive: true } };

export default async function ReceiptPage({ params }: { params: Promise<{ packetId: string }> }) {
  const { packetId } = await params;
  return <ApprovalReceipt packetId={packetId} />;
}
