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
  const user = await getCurrentUser();
  if (!user?.organizationId) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const [rules, summary, checks, periodicities, documents, officialRules] = await Promise.all([
    listComparisonRules(),
    getComparisonRulesSummary(),
    listComparisonRuleChecks(user.organizationId),
    listComparisonRulePeriodicities(user.organizationId),
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
