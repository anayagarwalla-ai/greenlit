import { NextResponse } from "next/server";
import { getOwnerIdentity } from "@/lib/owner-auth";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";

export async function POST() {
  const owner = await getOwnerIdentity();
  if (!owner.userId || !owner.ownerTokenHash) return NextResponse.json({ claimed: false }, { status: 409, headers: noStoreJsonHeaders() });
  const database = requireSupabaseAdmin();
  const { data, error } = await database.from("transaction_records").update({ owner_user_id: owner.userId }).eq("owner_token_hash", owner.ownerTokenHash).is("owner_user_id", null).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 503, headers: noStoreJsonHeaders() });
  return NextResponse.json({ claimed: (data ?? []).length }, { headers: noStoreJsonHeaders() });
}
