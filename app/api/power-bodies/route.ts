import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listPowerBodies } from "@/lib/rules-db";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  return NextResponse.json({ powerBodies: await listPowerBodies() });
}
