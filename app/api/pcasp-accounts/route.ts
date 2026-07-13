import { NextResponse } from "next/server";
import { listPcaspAccounts } from "@/lib/rules-db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    accounts: await listPcaspAccounts(),
  });
}
