import { NextResponse } from "next/server";
import {
  getComparisonRulesSummary,
  listComparisonRules,
  listOfficialFiscalDocuments,
  listOfficialFiscalRules,
} from "@/lib/rules-db";

export const runtime = "nodejs";

export async function GET() {
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
