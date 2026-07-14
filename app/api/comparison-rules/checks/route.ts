import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { saveComparisonRuleChecks } from "@/lib/rules-db";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const body = await request.json() as { ruleCode?: string; periodicity?: string; dates?: unknown[] };
  const ruleCode = body.ruleCode?.trim();
  const periodicity = body.periodicity;
  const dates = Array.isArray(body.dates) ? body.dates.map((date) => String(date ?? "")) : [];
  const periodCounts = { monthly: 12, bimonthly: 6, four_monthly: 3, annual: 1 } as const;
  const expectedPeriods = periodicity && periodicity in periodCounts
    ? periodCounts[periodicity as keyof typeof periodCounts]
    : 0;

  if (!ruleCode || !expectedPeriods || dates.length !== expectedPeriods || dates.some((date) => date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    return NextResponse.json({ error: "Dados de periodicidade invalidos." }, { status: 400 });
  }

  await saveComparisonRuleChecks(ruleCode, periodicity as keyof typeof periodCounts, dates);
  return NextResponse.json({ ok: true });
}
