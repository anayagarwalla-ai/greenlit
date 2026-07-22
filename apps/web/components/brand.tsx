"use client";

import Image from "next/image";
import Link from "next/link";

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link className={`brand ${inverse ? "brand--inverse" : ""}`} href="/" aria-label="Greenlit home" onClick={(event) => {
      if (window.location.pathname === "/" && window.location.hash) {
        event.preventDefault();
        window.history.pushState(null, "", "/");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }}>
      <Image
        className="brand-logo"
        src={inverse ? "/brand/greenlit-logo-inverse.png" : "/brand/greenlit-logo.png"}
        alt=""
        aria-hidden="true"
        width={1200}
        height={270}
        sizes="(max-width: 430px) 138px, 154px"
        unoptimized
      />
    </Link>
  );
}
