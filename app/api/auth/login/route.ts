import { NextResponse } from "next/server";
import { authenticateUser, createSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisicao invalida." }, { status: 400 });
  }

  const { cpf, password } = (body ?? {}) as { cpf?: unknown; password?: unknown };

  if (typeof cpf !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Informe CPF e senha." }, { status: 400 });
  }

  if (cpf.replace(/\D/g, "").length !== 11 || password.length > 256) {
    return NextResponse.json({ error: "Credenciais invalidas." }, { status: 401 });
  }

  const user = await authenticateUser(cpf, password);

  if (!user) {
    return NextResponse.json({ error: "CPF ou senha inválidos." }, { status: 401 });
  }

  await createSession(user.id);
  return NextResponse.json({ user });
}
