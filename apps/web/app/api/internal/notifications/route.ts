import { NextResponse } from "next/server";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import { deliverPendingNotifications } from "@/lib/notifications";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: noStoreJsonHeaders() });
  try { return NextResponse.json(await deliverPendingNotifications(), { headers: noStoreJsonHeaders() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Notification delivery failed." }, { status: 503, headers: noStoreJsonHeaders() }); }
}
