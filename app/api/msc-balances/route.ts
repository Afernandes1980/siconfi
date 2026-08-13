import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getLatestMscExerciseSummary, listLatestAutomaticRuleResults, saveAndCompareMscBalances } from "@/lib/rules-db";
import type { MscBalanceRow } from "@/lib/msc-balances";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }
  if (!user.organizationId) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 409 });

  const [exercise, automaticRuleResults] = await Promise.all([
    getLatestMscExerciseSummary(user.organizationId),
    listLatestAutomaticRuleResults(user.organizationId),
  ]);
  return NextResponse.json({ exercise, automaticRuleResults });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }
  if (!user.organizationId) return NextResponse.json({ error: "Selecione uma empresa." }, { status: 409 });

  const body = await request.json() as {
    competenceKey?: string;
    competenceLabel?: string;
    sourceFile?: string;
    rows?: MscBalanceRow[];
    powerBodyCodes?: Array<{ code: string; count: number }>;
    powerBodyRows?: Array<{ code: string; signature: string; count: number }>;
    automaticRuleResults?: Array<{ ruleCode: string; passed: boolean; details?: string }>;
  };
  const competenceKey = String(body.competenceKey ?? "").trim();
  const competenceLabel = String(body.competenceLabel ?? "").trim();
  const sourceFile = String(body.sourceFile ?? "").trim();
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const powerBodyCodes = Array.isArray(body.powerBodyCodes) ? body.powerBodyCodes : [];
  const powerBodyRows = Array.isArray(body.powerBodyRows) ? body.powerBodyRows : [];
  const allowedAutomaticRules = new Set(["D1_00019", "D1_00021", "D1_00022", "D1_00027", "D1_00028"]);
  const automaticRuleResults = Array.isArray(body.automaticRuleResults)
    ? body.automaticRuleResults.filter((item) => allowedAutomaticRules.has(item.ruleCode) && typeof item.passed === "boolean")
    : [];

  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(competenceKey)) {
    return NextResponse.json({ error: "Competencia invalida na celula B1." }, { status: 400 });
  }
  if (!sourceFile || rows.length === 0) {
    return NextResponse.json({ error: "A MSC nao possui saldos iniciais ou finais para armazenar." }, { status: 400 });
  }

  const comparison = await saveAndCompareMscBalances(
    user.organizationId,
    competenceKey,
    competenceLabel || competenceKey,
    sourceFile,
    rows,
    powerBodyCodes,
    powerBodyRows,
    automaticRuleResults,
  );
  return NextResponse.json(comparison);
}
