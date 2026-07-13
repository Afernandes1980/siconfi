import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getComparisonRulesSummary,
  listComparisonRules,
  listOfficialFiscalDocuments,
  listOfficialFiscalRules,
} from "@/lib/rules-db";

export const runtime = "nodejs";

export async function GET() {
  if (!(await getCurrentUser())) {
    return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });
  }

  const [rules, summary, documents, officialRules] = await Promise.all([
    listComparisonRules(),
    getComparisonRulesSummary(),
    listOfficialFiscalDocuments(),
    listOfficialFiscalRules(),
  ]);

  return NextResponse.json({
    rules,
    summary,
    officialFiscal: {
      documents,
      rules: officialRules,
    },
  });
}
