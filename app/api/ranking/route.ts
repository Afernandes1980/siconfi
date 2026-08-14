import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { evaluateDcaTimeliness } from "@/lib/dca-timeliness";
import { evaluateRgfExecutiveTimeliness, evaluateRgfLegislativeTimeliness } from "@/lib/rgf-executive-timeliness";
import { evaluateRreoHomologation, evaluateRreoTimeliness, type RreoDelivery } from "@/lib/rreo-timeliness";
import { fetchSiconfi, SiconfiApiError } from "@/lib/siconfi-api";

export const runtime = "nodejs";
const RANKING_EXERCISE = 2026;

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.organizationId || !user.organizationCode) return NextResponse.json({ error: "Selecione uma empresa com código IBGE válido." }, { status: 409 });
  const entityId = user.organizationCode.replace(/\D/g, "");
  if (!/^\d{7}$/.test(entityId)) {
    return NextResponse.json({ error: "O código IBGE da empresa deve possuir exatamente 7 dígitos.", receivedLength: entityId.length }, { status: 422 });
  }
  try {
    const query = new URLSearchParams({ id_ente: entityId, an_referencia: String(RANKING_EXERCISE) });
    const response = await fetchSiconfi("extrato_entregas", query) as { items?: RreoDelivery[] };
    const deliveries = response.items ?? [];
    return NextResponse.json({
      d1_00001: evaluateRreoHomologation(RANKING_EXERCISE, deliveries),
      d1_00002: evaluateDcaTimeliness(RANKING_EXERCISE, deliveries),
      d1_00003: evaluateRgfExecutiveTimeliness(RANKING_EXERCISE, deliveries),
      d1_00004: evaluateRgfLegislativeTimeliness(RANKING_EXERCISE, deliveries),
      d1_00006: evaluateRreoTimeliness(RANKING_EXERCISE, deliveries, new Date(), "D1_00006"),
    }, { headers: { "Cache-Control": "private, max-age=30" } });
  } catch (error) {
    if (error instanceof SiconfiApiError) {
      console.error("Siconfi recusou a avaliação consolidada:", { status: error.status, details: error.details, entityId, exercise: RANKING_EXERCISE });
      return NextResponse.json({ error: "O serviço do Siconfi está temporariamente indisponível. Tente novamente em alguns instantes." }, { status: 502 });
    }
    console.error("Erro ao avaliar as regras automáticas:", error);
    return NextResponse.json({ error: "Não foi possível consultar as avaliações automáticas." }, { status: 502 });
  }
}
