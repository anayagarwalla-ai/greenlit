import { NextResponse } from "next/server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, sha256 } from "@/lib/recordkeeping";
import { extractSourceFileText, SourceInputError } from "@/lib/source-extraction";
import { getOptionalUser } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ recordId: string }> }) {
  const user = await getOptionalUser();
  if (!user || !await betaAccessAllowedFresh(user)) return NextResponse.json({ error: "Sign in with the invited account that owns this milestone." }, { status: 401, headers: noStoreJsonHeaders() });
  const { recordId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: record, error: recordError } = await database.from("transaction_records").select("source_sha256").eq("id", recordId).eq("owner_user_id", user.id).single();
    if (recordError || !record) return NextResponse.json({ error: "This milestone was not found in your account." }, { status: 404, headers: noStoreJsonHeaders() });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose the original PDF, TXT, or Markdown SOW." }, { status: 422, headers: noStoreJsonHeaders() });
    const sourceText = await extractSourceFileText(file);
    const actualHash = sha256(sourceText);
    if (actualHash !== record.source_sha256) return NextResponse.json({ error: "This file does not match the source frozen into the retained record. Choose the exact original SOW revision." }, { status: 409, headers: noStoreJsonHeaders() });
    return NextResponse.json({ sourceText, sourceName: file.name, sourceSha256: actualHash }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    if (error instanceof SourceInputError) return NextResponse.json({ error: error.message }, { status: error.status, headers: noStoreJsonHeaders() });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The source could not be reattached." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
