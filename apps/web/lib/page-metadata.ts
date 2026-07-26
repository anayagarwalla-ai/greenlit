import type { Metadata } from "next";

const socialImage = {
  url: "/brand/greenlit-social-card.png",
  width: 1200,
  height: 630,
  alt: "Greenlit",
};

type PageMetadataInput = {
  title: string;
  description: string;
  path: `/${string}` | "/";
};

export function publicPageMetadata({ title, description, path }: PageMetadataInput): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      type: "website",
      url: path,
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage.url],
    },
  };
}

export function privatePageMetadata({ title, description, path }: PageMetadataInput): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: { index: false, follow: false, noarchive: true },
    openGraph: {
      title,
      description,
      type: "website",
      url: path,
      images: [],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [],
    },
  };
}
