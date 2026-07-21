import { getOptionalUser } from "./supabase-server";

export async function getOwnerIdentity() {
  const user = await getOptionalUser();
  return {
    user,
    userId: user?.id ?? null,
    email: user?.email ?? null,
  };
}
