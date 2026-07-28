import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://greenlitproof.vercel.app").replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/resources", "/trust", "/request-demo", "/privacy", "/terms", "/records", "/contact", "/workspace", "/review/demo", "/receipt/demo"],
        disallow: ["/admin", "/api", "/dashboard", "/login", "/receipt", "/review"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
