"use client";

import { useState, type FormEvent } from "react";

export default function LoginForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const data = await response.json() as { error?: string };

      if (!response.ok) {
        setError(data.error || "Nao foi possivel entrar.");
        return;
      }

      window.location.assign("/");
    } catch {
      setError("Nao foi possivel conectar ao servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="email">
          E-mail
        </label>
        <input
          autoComplete="username"
          autoFocus
          className="form-field"
          id="email"
          name="email"
          placeholder="usuario@exemplo.com"
          required
          type="email"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold text-slate-700" htmlFor="password">
          Senha
        </label>
        <input
          autoComplete="current-password"
          className="form-field"
          id="password"
          name="password"
          required
          type="password"
        />
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800" role="alert">
          {error}
        </p>
      )}

      <button className="form-button-primary w-full" disabled={loading} type="submit">
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
