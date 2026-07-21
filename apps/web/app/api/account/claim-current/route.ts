import { NextResponse } from "next/server";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";

export async function POST() {
  return NextResponse.json({ error: "Browser-token record recovery was retired. Retained records are account-owned." }, { status: 410, headers: noStoreJsonHeaders() });
}
