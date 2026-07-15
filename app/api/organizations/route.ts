import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { initializeDatabase } from "@/lib/rules-db";
import { database } from "@/lib/turso";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  await initializeDatabase();
  const result = await database.execute(`
    SELECT id, code, name, document, organization_type AS organizationType,
      state, municipality, email, environment, active
    FROM organizations
    ${user.role === "admin" ? "" : "WHERE active = 1"}
    ORDER BY name
  `);
  const organizations = result.rows.map((row: unknown[]) => Object.fromEntries(
    result.columns.map((column: string, index: number) => [column, row[index]]),
  ));
  return NextResponse.json({ organizations });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const input = organizationInput(body);
  if (!input) return NextResponse.json({ error: "Informe código e nome da empresa." }, { status: 400 });
  await initializeDatabase();
  try {
    const municipality = await municipalityForCode(String(input.values[0]));
    if (!municipality) return NextResponse.json({ error: "Selecione um código de município válido do IBGE." }, { status: 400 });
    input.values[4] = municipality.stateCode;
    input.values[5] = municipality.name;
    await database.execute(`
      INSERT INTO organizations (code, name, document, organization_type, state, municipality, email, environment, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [...input.values, 1]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Já existe uma empresa com este código." }, { status: 409 });
  }
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (user?.role !== "admin") return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const id = Number(body.id);
  const input = organizationInput(body);
  const active = body.active === true || body.active === 1;
  if (!Number.isInteger(id) || !input) return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  await initializeDatabase();
  try {
    if (String(input.values[0]) !== "DEMO") {
      const municipality = await municipalityForCode(String(input.values[0]));
      if (!municipality) return NextResponse.json({ error: "Selecione um código de município válido do IBGE." }, { status: 400 });
      input.values[4] = municipality.stateCode;
      input.values[5] = municipality.name;
    }
    await database.execute(`
      UPDATE organizations SET code = ?, name = ?, document = ?, organization_type = ?, state = ?,
        municipality = ?, email = ?, environment = ?, active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [...input.values, active ? 1 : 0, id]);
    if (!active) await database.execute("UPDATE app_sessions SET organization_id = NULL WHERE organization_id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Não foi possível atualizar a empresa." }, { status: 409 });
  }
}

function organizationInput(body: Record<string, unknown>) {
  const code = String(body.code ?? "").trim().toUpperCase();
  const name = String(body.name ?? "").trim();
  if (!code || !name) return null;
  const environment = body.environment === "demonstration" ? "demonstration" : "production";
  return { values: [code, name, String(body.document ?? "").trim(), String(body.organizationType ?? "Prefeitura Municipal").trim(), String(body.state ?? "").trim().toUpperCase(), String(body.municipality ?? "").trim(), String(body.email ?? "").trim().toLowerCase(), environment] };
}

async function municipalityForCode(code: string) {
  const result = await database.execute(
    "SELECT name, state_code AS stateCode FROM ibge_municipalities WHERE code = ? LIMIT 1",
    [code],
  );
  const row = result.rows[0];
  return row ? { name: String(row[0]), stateCode: String(row[1]) } : null;
}
