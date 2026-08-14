import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { fetchSiconfi, isSiconfiResource, SiconfiApiError, siconfiResources, validateSiconfiQuery } from "@/lib/siconfi-api";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ resource: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Nao autorizado." }, { status: 401 });

  const { resource } = await context.params;
  if (!isSiconfiResource(resource)) {
    return NextResponse.json({ error: "Recurso Siconfi desconhecido.", resources: Object.keys(siconfiResources) }, { status: 404 });
  }

  try {
    const query = validateSiconfiQuery(resource, new URL(request.url).searchParams);
    const data = await fetchSiconfi(resource, query);
    return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof SiconfiApiError) {
      return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    }
    console.error("Erro ao consultar o Siconfi:", error);
    return NextResponse.json({ error: "Nao foi possivel consultar o Siconfi." }, { status: 502 });
  }
}
