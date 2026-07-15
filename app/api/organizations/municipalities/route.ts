import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { initializeDatabase } from "@/lib/rules-db";
import { createDatabaseConnection } from "@/lib/turso";

export async function GET(request: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ municipalities: [] });
  await initializeDatabase();
  const database = createDatabaseConnection();
  const result = await database.execute(`
      SELECT code, name, state_code AS stateCode, state_name AS stateName
      FROM ibge_municipalities
      WHERE code LIKE ? OR lower(name) LIKE lower(?) OR lower(state_code || ' ' || name) LIKE lower(?)
      ORDER BY name LIMIT 25
    `, [`${query.replace(/\D/g, "")}%`, `%${query}%`, `%${query}%`]);
  await database.close();
  const municipalities = result.rows.map((row: unknown[]) => Object.fromEntries(
    result.columns.map((column: string, index: number) => [column, row[index]]),
  ));
  return NextResponse.json({ municipalities });
}
