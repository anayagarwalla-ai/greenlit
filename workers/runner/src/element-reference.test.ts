import type { Page } from "@cloudflare/playwright";
import { describe, expect, it, vi } from "vitest";
import { resolveLocator } from "./element-reference";

describe("resolveLocator", () => {
  it("uses the shared parser and keeps later colons in the accessible name", () => {
    const locator = {};
    const getByRole = vi.fn(() => locator);
    const page = { getByRole } as unknown as Pick<Page, "getByRole">;

    expect(resolveLocator(page, "button:Save: draft")).toBe(locator);
    expect(getByRole).toHaveBeenCalledWith("button", {
      name: "Save: draft",
      exact: true,
    });
  });

  it.each(["button:", "unknown:Save", "button"])("rejects malformed references before locating %s", (elementRef) => {
    const getByRole = vi.fn();
    const page = { getByRole } as unknown as Pick<Page, "getByRole">;

    expect(() => resolveLocator(page, elementRef)).toThrow();
    expect(getByRole).not.toHaveBeenCalled();
  });
});
