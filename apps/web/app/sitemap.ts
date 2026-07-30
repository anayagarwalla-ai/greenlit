import type { MetadataRoute } from "next";
import { publicResourceGuides } from "@/lib/resource-library";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://greenlitproof.vercel.app").replace(/\/$/, "");
  const lastModified = new Date("2026-07-26T00:00:00-06:00");
  const publicPages = [
    { path: "", priority: 1, changeFrequency: "weekly" as const },
    { path: "/resources", priority: 0.9, changeFrequency: "weekly" as const },
    { path: "/resources/roi-calculator", priority: 0.7, changeFrequency: "monthly" as const },
    { path: "/resources/changelog", priority: 0.6, changeFrequency: "weekly" as const },
    { path: "/request-demo", priority: 0.9, changeFrequency: "monthly" as const },
    { path: "/trust", priority: 0.8, changeFrequency: "monthly" as const },
    { path: "/privacy", priority: 0.4, changeFrequency: "monthly" as const },
    { path: "/privacy-request", priority: 0.4, changeFrequency: "monthly" as const },
    { path: "/terms", priority: 0.4, changeFrequency: "monthly" as const },
    { path: "/records", priority: 0.4, changeFrequency: "monthly" as const },
    { path: "/contact", priority: 0.4, changeFrequency: "monthly" as const },
  ];

  return [
    ...publicPages.map((page) => ({
      url: `${baseUrl}${page.path}`,
      lastModified,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })),
    ...publicResourceGuides.map((guide) => ({
      url: `${baseUrl}/resources/${guide.slug}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
