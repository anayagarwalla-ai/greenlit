import type { Metadata } from "next";
import { ClientReview } from "@/components/client-review";
import { privatePageMetadata } from "@/lib/page-metadata";

export async function generateMetadata({ params }: { params: Promise<{ packetId: string }> }): Promise<Metadata> {
  const { packetId } = await params;
  return privatePageMetadata({
    title: "Secure milestone review",
    description: "A private, recipient-bound Greenlit milestone review.",
    path: `/review/${encodeURIComponent(packetId)}`,
  });
}

export default async function ReviewPage({ params }: { params: Promise<{ packetId: string }> }) {
  const { packetId } = await params;
  return <ClientReview packetId={packetId} />;
}
