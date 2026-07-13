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

  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Informe e-mail e senha." }, { status: 400 });
  }

  if (email.length > 254 || password.length > 256) {
    return NextResponse.json({ error: "Credenciais invalidas." }, { status: 401 });
  }

  const user = await authenticateUser(email, password);

  if (!user) {
    return NextResponse.json({ error: "E-mail ou senha invalidos." }, { status: 401 });
  }

  await createSession(user.id);
  return NextResponse.json({ user });
}
