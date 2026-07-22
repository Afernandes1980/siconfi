import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getLatestMscExerciseSummary, saveAndCompareMscBalances } from "@/lib/rules-db";
import type { MscBalanceRow } from "@/lib/msc-balances";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  return NextResponse.json({ exercise: await getLatestMscExerciseSummary() });
}

export async function POST(request: Request) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const body = await request.json() as {
    competenceKey?: string;
    competenceLabel?: string;
    sourceFile?: string;
    rows?: MscBalanceRow[];
    powerBodyCodes?: Array<{ code: string; count: number }>;
    powerBodyRows?: Array<{ code: string; signature: string; count: number }>;
  };
  const competenceKey = String(body.competenceKey ?? "").trim();
  const competenceLabel = String(body.competenceLabel ?? "").trim();
  const sourceFile = String(body.sourceFile ?? "").trim();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const powerBodyCodes = Array.isArray(body.powerBodyCodes) ? body.powerBodyCodes : [];
  const powerBodyRows = Array.isArray(body.powerBodyRows) ? body.powerBodyRows : [];

  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(competenceKey)) {
    return NextResponse.json({ error: "Competencia invalida na celula B1." }, { status: 400 });
  }
  if (!sourceFile || rows.length === 0) {
    return NextResponse.json({ error: "A MSC nao possui saldos iniciais ou finais para armazenar." }, { status: 400 });
  }

  const comparison = await saveAndCompareMscBalances(
    competenceKey,
    competenceLabel || competenceKey,
    sourceFile,
    rows,
    powerBodyCodes,
    powerBodyRows,
  );
  return NextResponse.json(comparison);
}
