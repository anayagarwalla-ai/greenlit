"use client";

import type { MouseEvent } from "react";

export function SkipLink() {
  const focusMainContent = (event: MouseEvent<HTMLAnchorElement>) => {
    const main = document.querySelector<HTMLElement>("main");
    if (!main) return;
    event.preventDefault();
    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
    main.focus({ preventScroll: true });
    main.scrollIntoView({ block: "start" });
  };

  return <a className="skip-link" href="#main-content" onClick={focusMainContent}>Skip to main content</a>;
}
