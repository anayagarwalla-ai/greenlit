import { ApprovalReceipt } from "@/components/approval-receipt";
import { privatePageMetadata } from "@/lib/page-metadata";

export const metadata = privatePageMetadata({
  title: "Sample milestone approval record",
  description: "A synthetic Greenlit approval receipt that does not represent a retained client decision.",
  path: "/receipt/demo",
});

export default function DemoReceiptPage() {
  return <ApprovalReceipt packetId="demo" demo />;
}
