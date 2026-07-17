import { NextResponse } from "next/server";
import { getCurrentUser, selectCurrentOrganization } from "@/lib/auth";

export async function POST(request: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const body = await request.json() as { organizationId?: unknown };
  const organizationId = Number(body.organizationId);
  if (!Number.isInteger(organizationId) || !(await selectCurrentOrganization(organizationId))) {
    return NextResponse.json({ error: "Empresa inválida ou bloqueada." }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
