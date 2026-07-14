import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getComparisonRulesSummary,
  listComparisonRuleChecks,
  listComparisonRulePeriodicities,
  listComparisonRules,
  listOfficialFiscalDocuments,
  listOfficialFiscalRules,
} from "@/lib/rules-db";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const [rules, summary, checks, periodicities, documents, officialRules] = await Promise.all([
    listComparisonRules(),
    getComparisonRulesSummary(),
    listComparisonRuleChecks(),
    listComparisonRulePeriodicities(),
    listOfficialFiscalDocuments(),
    listOfficialFiscalRules(),
  ]);

  return NextResponse.json({
    rules,
    summary,
    checks,
    periodicities,
    officialFiscal: {
      documents,
      rules: officialRules,
    },
  });
}
