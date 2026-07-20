import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const version = new URL(request.url).searchParams.get("version");
  if (version === "rc1") return NextResponse.json({ error: "CRM handoff failed" }, { status: 500 });
  return NextResponse.json({ id: `lead_${crypto.randomUUID()}`, created: true }, { status: 201 });
}

