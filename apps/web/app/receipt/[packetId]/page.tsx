import type { Metadata } from "next";
import { ApprovalReceipt } from "@/components/approval-receipt";
import { privatePageMetadata } from "@/lib/page-metadata";

export async function generateMetadata({ params }: { params: Promise<{ packetId: string }> }): Promise<Metadata> {
  const { packetId } = await params;
  return privatePageMetadata({
    title: "Approval record",
    description: "A private Greenlit milestone decision and approval record.",
    path: `/receipt/${encodeURIComponent(packetId)}`,
  });
}

export default async function ReceiptPage({ params }: { params: Promise<{ packetId: string }> }) {
  const { packetId } = await params;
  return <ApprovalReceipt packetId={packetId} />;
}
