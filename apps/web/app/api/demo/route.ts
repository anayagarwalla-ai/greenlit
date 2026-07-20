import { NextResponse } from "next/server";
import { demoCriteria, demoMilestone, sowExcerpt } from "@/lib/demo";

export async function POST() {
  return NextResponse.json({ milestone: demoMilestone, criteria: demoCriteria, source: sowExcerpt, mode: "seeded-demo" }, { status: 201 });
}

export async function GET() {
  return NextResponse.json({ milestone: demoMilestone, criteria: demoCriteria, source: sowExcerpt, mode: "seeded-demo" });
}

