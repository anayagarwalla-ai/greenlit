"use client";

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
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span>Greenlit</span>
    </Link>
  );
}
