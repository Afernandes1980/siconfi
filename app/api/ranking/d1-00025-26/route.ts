import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { evaluateLatestMscLiabilityNatures } from "@/lib/msc-account-nature";
import { fetchSiconfi, SiconfiApiError } from "@/lib/siconfi-api";
import type { RreoDelivery } from "@/lib/rreo-timeliness";

export const runtime = "nodejs";
const RANKING_EXERCISE = 2026;
export async function GET() {
  const user = await getCurrentUser();
  if (!user?.organizationId || !user.organizationCode) return NextResponse.json({ error: "Selecione uma empresa com código IBGE válido." }, { status: 409 });
  try {
    const query = new URLSearchParams({ id_ente: user.organizationCode, an_referencia: String(RANKING_EXERCISE), limit: "500", offset: "0" });
    const response = await fetchSiconfi("extrato_entregas", query) as { items?: RreoDelivery[] };
    return NextResponse.json(await evaluateLatestMscLiabilityNatures(RANKING_EXERCISE, user.organizationCode, response.items ?? []));
  } catch (error) {
    if (error instanceof SiconfiApiError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Erro ao avaliar D1_00025 e D1_00026:", error);
    return NextResponse.json({ error: "Não foi possível avaliar as naturezas do passivo e patrimônio líquido." }, { status: 502 });
  }
}
