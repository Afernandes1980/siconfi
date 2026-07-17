import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { initializeDatabase } from "@/lib/rules-db";
import { database } from "@/lib/turso";

export const runtime = "nodejs";

async function requireAdmin() {
  const user = await getCurrentUser();
  return user?.role === "admin" ? user : null;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  await initializeDatabase();
  const result = await database.execute(`
    SELECT id, cpf, email, display_name AS displayName, role, active, created_at AS createdAt
    FROM app_users ORDER BY display_name, email
  `);
  const users = result.rows.map((row: unknown[]) => Object.fromEntries(
    result.columns.map((column: string, index: number) => [column, row[index]]),
  ));
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const email = String(body.email ?? "").trim().toLowerCase();
  const cpf = String(body.cpf ?? "").replace(/\D/g, "");
  const displayName = String(body.displayName ?? "").trim();
  const password = String(body.password ?? "");
  if (cpf.length !== 11 || !/^\S+@\S+\.\S+$/.test(email) || !displayName || password.length < 12 || password.length > 256) {
    return NextResponse.json({ error: "Informe nome, CPF, e-mail válido e senha com pelo menos 12 caracteres." }, { status: 400 });
  }
  await initializeDatabase();
  try {
    await database.execute(
      "INSERT INTO app_users (cpf, email, display_name, password_hash, role, active) VALUES (?, ?, ?, ?, 'admin', 1)",
      [cpf, email, displayName, await hashPassword(password)],
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Já existe um usuário com este e-mail." }, { status: 409 });
  }
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const id = Number(body.id);
  const email = String(body.email ?? "").trim().toLowerCase();
  const cpf = String(body.cpf ?? "").replace(/\D/g, "");
  const displayName = String(body.displayName ?? "").trim();
  const password = String(body.password ?? "");
  const active = body.active === true || body.active === 1;
  if (!Number.isInteger(id) || cpf.length !== 11 || !/^\S+@\S+\.\S+$/.test(email) || !displayName || (password && (password.length < 12 || password.length > 256))) {
    return NextResponse.json({ error: "Dados do usuário inválidos." }, { status: 400 });
  }
  if (id === admin.id && !active) {
    return NextResponse.json({ error: "Você não pode bloquear o usuário conectado." }, { status: 400 });
  }
  await initializeDatabase();
  try {
    if (password) {
      await database.execute(
        "UPDATE app_users SET cpf = ?, email = ?, display_name = ?, password_hash = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [cpf, email, displayName, await hashPassword(password), active ? 1 : 0, id],
      );
    } else {
      await database.execute(
        "UPDATE app_users SET cpf = ?, email = ?, display_name = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [cpf, email, displayName, active ? 1 : 0, id],
      );
    }
    if (!active) await database.execute("DELETE FROM app_sessions WHERE user_id = ?", [id]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Não foi possível atualizar o usuário. Verifique o e-mail." }, { status: 409 });
  }
}
