"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function ResourceCopyBlock({ label, content }: { label: string; content: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 1800);
    } catch {
      setStatus("error");
    }
  };

  return (
    <section className="resource-copy">
      <div className="resource-copy__head">
        <strong>{label}</strong>
        <button type="button" onClick={copy} aria-label={`Copy ${label}`}>
          {status === "copied" ? <Check size={15} /> : <Copy size={15} />}
          {status === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{content}</pre>
      <span className="sr-only" role="status" aria-live="polite">{status === "copied" ? `${label} copied to clipboard.` : ""}</span>
      {status === "error" && <p className="resource-copy__error" role="alert">Clipboard access is unavailable. Select the text above and copy it manually.</p>}
    </section>
  );
}
