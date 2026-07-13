import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Entrar | Siconfi",
};

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="app-background flex min-h-screen items-center justify-center px-5 py-10">
      <section className="panel w-full max-w-md p-7 sm:p-9">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Siconfi</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Acesso restrito</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Entre com seu usuário autorizado para acessar o portal de análise da STN.
        </p>
        <LoginForm />
      </section>
    </main>
  );
}
