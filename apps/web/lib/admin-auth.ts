import { adminAccessAllowed } from "./beta-access";
import { getSupabaseServerClient } from "./supabase-server";

export async function getAdminAuthorization() {
  const client = await getSupabaseServerClient();
  if (!client) return { user: null, aal2: false, client: null };
  const { data } = await client.auth.getUser();
  const user = data.user && adminAccessAllowed(data.user) ? data.user : null;
  if (!user) return { user: null, aal2: false, client };
  const { data: assurance, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  return { user, aal2: !error && assurance.currentLevel === "aal2", client };
}
