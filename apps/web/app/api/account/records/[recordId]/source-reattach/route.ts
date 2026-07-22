import { NextResponse } from "next/server";
import { z } from "zod";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders, sha256 } from "@/lib/recordkeeping";
import { normalizeSourceText } from "@/lib/analysis";
import { extractSourceFileText, SourceInputError } from "@/lib/source-extraction";
import { getOptionalUser } from "@/lib/supabase-server";

export const runtime = "nodejs";

const pastedSourceSchema = z.object({
  text: z.string().min(1).max(45_000),
  sourceName: z.string().trim().min(1).max(160).default("Pasted SOW"),
});

export async function POST(request: Request, context: { params: Promise<{ recordId: string }> }) {
  const user = await getOptionalUser();
  if (!user || !await betaAccessAllowedFresh(user)) return NextResponse.json({ error: "Sign in with the invited account that owns this milestone." }, { status: 401, headers: noStoreJsonHeaders() });
  const { recordId } = await context.params;
  try {
    const database = requireSupabaseAdmin();
    const { data: record, error: recordError } = await database.from("transaction_records").select("source_sha256").eq("id", recordId).eq("owner_user_id", user.id).single();
    if (recordError || !record) return NextResponse.json({ error: "This milestone was not found in your account." }, { status: 404, headers: noStoreJsonHeaders() });
    const contentType = request.headers.get("content-type") ?? "";
    let sourceText: string;
    let sourceName: string;
    if (contentType.includes("application/json")) {
      const parsed = pastedSourceSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return NextResponse.json({ error: "Paste the exact original SOW text." }, { status: 422, headers: noStoreJsonHeaders() });
      sourceText = normalizeSourceText(parsed.data.text);
      sourceName = parsed.data.sourceName;
      if (!sourceText) return NextResponse.json({ error: "The pasted source is empty." }, { status: 422, headers: noStoreJsonHeaders() });
    } else {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "Choose the original PDF, TXT, or Markdown SOW, or paste its text." }, { status: 422, headers: noStoreJsonHeaders() });
      sourceText = await extractSourceFileText(file);
      sourceName = file.name;
    }
    const actualHash = sha256(sourceText);
    if (actualHash !== record.source_sha256) return NextResponse.json({ error: "This source does not match the source frozen into the retained record. Use the exact original SOW revision." }, { status: 409, headers: noStoreJsonHeaders() });
    return NextResponse.json({ sourceText, sourceName, sourceSha256: actualHash }, { headers: noStoreJsonHeaders() });
  } catch (error) {
    if (error instanceof SourceInputError) return NextResponse.json({ error: error.message }, { status: error.status, headers: noStoreJsonHeaders() });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The source could not be reattached." }, { status: 503, headers: noStoreJsonHeaders() });
  }
}
