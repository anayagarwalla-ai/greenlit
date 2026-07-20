import { cookies } from "next/headers";
import { getOptionalUser } from "./supabase-server";
import { sha256 } from "./recordkeeping";

export async function getOwnerIdentity() {
  const user = await getOptionalUser();
  const ownerToken = (await cookies()).get("mp_owner")?.value;
  return {
    user,
    userId: user?.id ?? null,
    email: user?.email ?? null,
    ownerTokenHash: ownerToken ? sha256(ownerToken) : null,
  };
}
