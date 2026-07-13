import { NextResponse } from "next/server";
import { listAccountNatures } from "@/lib/rules-db";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({
    natures: listAccountNatures(),
  });
}
