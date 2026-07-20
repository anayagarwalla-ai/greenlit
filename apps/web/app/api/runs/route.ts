import { NextResponse } from "next/server";
import { z } from "zod";
import { checkSpecSchema } from "@milestoneproof/contracts";
import { signRunnerRequest } from "@/lib/hmac";

const schema = z.object({ milestoneId: z.string().min(1), revision: z.number().int().positive(), targetOrigin: z.string().url(), checks: z.array(checkSpecSchema).min(1).max(40), idempotencyKey: z.string().min(8).max(200) });

export async function POST(request: Request) {
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "One or more checks are invalid or unconfirmed.", issues: body.error.issues }, { status: 422 });
  const jobId = `job_${crypto.randomUUID()}`;
  const runnerUrl = process.env.RUNNER_URL;
  const secret = process.env.RUNNER_HMAC_SECRET;
  if (runnerUrl && secret) {
    const payload = JSON.stringify({ jobId });
    const signed = await signRunnerRequest(payload, secret);
    const dispatched = await fetch(`${runnerUrl.replace(/\/$/, "")}/v1/jobs`, { method: "POST", headers: { "content-type": "application/json", "x-mp-timestamp": signed.timestamp, "x-mp-signature": signed.signature }, body: payload });
    if (!dispatched.ok) return NextResponse.json({ error: "The verification runner is temporarily unavailable." }, { status: 502 });
  }
  return NextResponse.json({ jobId, status: "QUEUED", mode: runnerUrl ? "cloud" : "demo" }, { status: 202, headers: { Location: `/api/runs/${jobId}` } });
}

