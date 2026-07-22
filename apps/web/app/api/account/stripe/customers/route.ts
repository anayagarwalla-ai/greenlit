import { NextResponse } from "next/server";
import { z } from "zod";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { getStripeAccessForOwner, listStripeCustomers } from "@/lib/stripe-api";
import { getOptionalUser } from "@/lib/supabase-server";

const emailSchema = z.string().email().max(320);

export async function GET(request: Request) {
  const user = await getOptionalUser();
  if (!user || !await betaAccessAllowedFresh(user)) return NextResponse.json({ error: "Sign in with an invited account to continue." }, { status: 401, headers: noStoreJsonHeaders() });
  const parsed = emailSchema.safeParse(new URL(request.url).searchParams.get("email"));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid billing email." }, { status: 422, headers: noStoreJsonHeaders() });
  try {
    const access = await getStripeAccessForOwner(user.id);
    const customers = await listStripeCustomers(access.accessToken, parsed.data);
    return NextResponse.json({ customers: customers.map((customer) => ({ id: customer.id, name: customer.name ?? "", email: customer.email ?? "" })) }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Stripe customers could not be loaded." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
