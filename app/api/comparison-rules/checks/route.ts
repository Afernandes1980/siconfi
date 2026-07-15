import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { saveComparisonRuleChecks } from "@/lib/rules-db";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user?.organizationId) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const body = await request.json() as { ruleCode?: string; periodicity?: string; dates?: unknown[]; quantities?: unknown[] };
  const ruleCode = body.ruleCode?.trim();
  const periodicity = body.periodicity;
  const dates = Array.isArray(body.dates) ? body.dates.map((date) => String(date ?? "")) : [];
  const quantities = Array.isArray(body.quantities)
    ? body.quantities.map((quantity) => quantity === "" || quantity === null || quantity === undefined ? null : Number(quantity))
    : dates.map(() => null);
  const periodCounts = { monthly: 12, bimonthly: 6, four_monthly: 3, annual: 1, not_applicable: 0 } as const;
  const expectedPeriods = periodicity && periodicity in periodCounts
    ? periodCounts[periodicity as keyof typeof periodCounts]
    : 0;

  if (!ruleCode || !periodicity || !(periodicity in periodCounts) || dates.length !== expectedPeriods || quantities.length !== expectedPeriods || dates.some((date) => date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) || quantities.some((quantity) => quantity !== null && (!Number.isInteger(quantity) || quantity < 0))) {
    return NextResponse.json({ error: "Dados de periodicidade invalidos." }, { status: 400 });
  }

  await saveComparisonRuleChecks(user.organizationId, ruleCode, periodicity as keyof typeof periodCounts, dates, quantities);
  return NextResponse.json({ ok: true });
}
