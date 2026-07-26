import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { betaAccessAllowedFresh } from "@/lib/beta-access";
import { requireSupabaseAdmin } from "@/lib/database";
import { noStoreJsonHeaders } from "@/lib/recordkeeping";
import {
  assertReviewSnapshotIntegrity,
  receiptSessionAuthorized,
  receiptSessionCookieName,
  reviewSessionAuthorized,
  reviewSessionCookieName,
} from "@/lib/review-session";
import { getOptionalUser } from "@/lib/supabase-server";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/json": "json",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ packetId: string; criterionId: string }> },
) {
  const { packetId, criterionId } = await context.params;
  const cookieStore = await cookies();
  const reviewSession = cookieStore.get(reviewSessionCookieName(packetId))?.value;
  const receiptSession = cookieStore.get(receiptSessionCookieName(packetId))?.value;
  const user = await getOptionalUser();
  if (!reviewSession && !receiptSession && !user) {
    return NextResponse.json(
      { error: "Open the secure review link or sign in as the milestone owner before downloading evidence." },
      { status: 401, headers: noStoreJsonHeaders() },
    );
  }

  try {
    const database = requireSupabaseAdmin();
    const { data: packet, error } = await database
      .from("review_packets_v2")
      .select("id,record_id,snapshot,snapshot_sha256,expires_at,revoked_at,decision")
      .eq("public_id", packetId)
      .single();
    if (error || !packet) {
      return NextResponse.json(
        { error: "The review record was not found." },
        { status: 404, headers: noStoreJsonHeaders() },
      );
    }

    assertReviewSnapshotIntegrity(packet.snapshot, packet.snapshot_sha256);
    const reviewerAuthorized = await reviewSessionAuthorized(database, packet.id, reviewSession);
    const receiptAuthorized = packet.decision
      ? await receiptSessionAuthorized(database, packet.id, receiptSession)
      : false;
    const activeOwner = user && await betaAccessAllowedFresh(user) ? user : null;
    const { data: ownerRecord } = activeOwner
      ? await database
          .from("transaction_records")
          .select("id")
          .eq("id", packet.record_id)
          .eq("owner_user_id", activeOwner.id)
          .maybeSingle()
      : { data: null };
    if (!reviewerAuthorized && !receiptAuthorized && !ownerRecord) {
      return NextResponse.json(
        { error: "The review session is invalid or this account does not own the record." },
        { status: 401, headers: noStoreJsonHeaders() },
      );
    }
    if (packet.revoked_at && !packet.decision) {
      return NextResponse.json(
        { error: "This review packet was revoked." },
        { status: 410, headers: noStoreJsonHeaders() },
      );
    }
    if (!ownerRecord && !receiptAuthorized && new Date(packet.expires_at).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "This review packet has expired." },
        { status: 410, headers: noStoreJsonHeaders() },
      );
    }

    const snapshot = packet.snapshot as Record<string, unknown>;
    const run = snapshot.run && typeof snapshot.run === "object"
      ? snapshot.run as Record<string, unknown>
      : null;
    const artifacts = run && Array.isArray(run.artifacts)
      ? run.artifacts as Array<Record<string, unknown>>
      : [];
    const artifact = artifacts.find((item) => item.criterionId === criterionId);
    const storagePath = typeof artifact?.storagePath === "string" ? artifact.storagePath : "";
    if (!storagePath) {
      return NextResponse.json(
        { error: "Evidence is unavailable for this criterion." },
        { status: 404, headers: noStoreJsonHeaders() },
      );
    }

    const { data, error: downloadError } = await database.storage.from("evidence").download(storagePath);
    if (downloadError || !data) throw new Error(downloadError?.message ?? "Evidence object was not found.");
    const declaredMime = typeof artifact?.mimeType === "string" ? artifact.mimeType : "";
    const mimeType = MIME_EXTENSIONS[declaredMime] ? declaredMime : "application/octet-stream";
    const extension = MIME_EXTENSIONS[mimeType] ?? "bin";
    const safeCriterion = criterionId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "criterion";
    const bytes = await data.arrayBuffer();

    return new NextResponse(bytes, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Pragma": "no-cache",
        "Content-Type": mimeType,
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `attachment; filename="${safeCriterion}-evidence.${extension}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Evidence download failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json(
      { error: "The evidence download is temporarily unavailable." },
      { status: 503, headers: noStoreJsonHeaders() },
    );
  }
}
