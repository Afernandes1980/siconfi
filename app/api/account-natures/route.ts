import { NextResponse } from "next/server";
import { listAccountNatures } from "@/lib/rules-db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    natures: await listAccountNatures(),
  });
}
