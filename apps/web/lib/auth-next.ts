const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function safeAuthNext(value: string | null | undefined): string {
  if (!value) return "/dashboard";
  try {
    const parsed = new URL(value, "https://greenlit.invalid");
    if (parsed.origin !== "https://greenlit.invalid") return "/dashboard";
    if (parsed.pathname === "/dashboard" && !parsed.search && !parsed.hash) return "/dashboard";
    if (parsed.pathname !== "/workspace" || parsed.hash) return "/dashboard";
    const draftId = parsed.searchParams.get("draft");
    if (!draftId) return parsed.search ? "/dashboard" : "/workspace";
    if (!UUID.test(draftId) || [...parsed.searchParams.keys()].some((key) => key !== "draft")) return "/dashboard";
    return `/workspace?draft=${encodeURIComponent(draftId)}`;
  } catch { return "/dashboard"; }
}
