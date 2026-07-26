import { privatePageMetadata } from "@/lib/page-metadata";
import { ClientReview } from "@/components/client-review";

export const metadata = privatePageMetadata({
  title: "Sample client milestone review",
  description: "A synthetic Greenlit client-review example that does not create or retain a transaction record.",
  path: "/review/demo",
});

export default function DemoReviewPage() {
  return <ClientReview packetId="demo" demo />;
}
