import { NextResponse } from "next/server";
import {
  getComparisonRulesSummary,
  listComparisonRules,
  listOfficialFiscalDocuments,
  listOfficialFiscalRules,
} from "@/lib/rules-db";

export const runtime = "nodejs";

export function GET() {
  const rules = listComparisonRules();

  return NextResponse.json({
    rules,
    summary: getComparisonRulesSummary(),
    officialFiscal: {
      documents: listOfficialFiscalDocuments(),
      rules: listOfficialFiscalRules(),
    },
  });
}
