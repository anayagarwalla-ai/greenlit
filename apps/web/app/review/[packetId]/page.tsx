import type { Metadata } from "next";
import { ClientReview } from "@/components/client-review";

export const metadata: Metadata = { title: "Secure milestone review", robots: { index: false, follow: false, noarchive: true } };

export default async function ReviewPage({ params }: { params: Promise<{ packetId: string }> }) {
  const { packetId } = await params;
  return <ClientReview packetId={packetId} />;
}

