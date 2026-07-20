import Link from "next/link";

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <Link className={`brand ${inverse ? "brand--inverse" : ""}`} href="/" aria-label="MilestoneProof home">
      <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
      <span>MilestoneProof</span>
    </Link>
  );
}

