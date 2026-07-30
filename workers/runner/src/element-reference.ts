import { parseAccessibleElementRef } from "@greenlit/contracts";
import type { Page } from "@cloudflare/playwright";

export function resolveLocator(page: Pick<Page, "getByRole">, elementRef: string) {
  const { role, name } = parseAccessibleElementRef(elementRef);
  return page.getByRole(role, { name, exact: true });
}
