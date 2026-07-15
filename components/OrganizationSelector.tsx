"use client";

import { useEffect, useState } from "react";

type Organization = { id: number; code: string; name: string; document: string; municipality: string; state: string; environment: string; active: number };

export default function OrganizationSelector({ currentUser }: { currentUser: { displayName: string; role: string } }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selecting, setSelecting] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const visibleOrganizations = organizations.filter((organization) =>
    !normalizedSearch || `${organization.document} ${organization.name} ${organization.state} ${organization.code}`.toLocaleLowerCase("pt-BR").includes(normalizedSearch),
  );

  useEffect(() => {
    fetch("/api/organizations", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar as empresas.");
      setOrganizations((data.organizations ?? []).filter((organization: Organization) => Boolean(organization.active)));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar as empresas."))
      .finally(() => setLoading(false));
  }, []);

  async function selectOrganization(id: number) {
    setSelecting(id);
    setError("");
    const response = await fetch("/api/organizations/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: id }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Não foi possível abrir o ambiente."); setSelecting(null); return; }
    window.location.assign("/");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  return <main className="app-background min-h-screen"><section className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
      <div><p className="text-xs font-semibold uppercase text-cyan-700">Siconfi</p><h1 className="mt-2 text-3xl font-semibold text-slate-950">Selecionar Empresa</h1><p className="mt-2 text-sm text-slate-600">Escolha o município ou ambiente que deseja acessar.</p></div>
      <div className="flex items-center gap-3"><span className="text-sm font-semibold text-slate-700">{currentUser.displayName}</span><button className="form-button-secondary" onClick={logout}>Sair</button></div>
    </header>
    {error && <p className="mt-5 rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}
    <section className="panel mt-7 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 p-4">
        <input className="form-field min-w-64 flex-1" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar por CNPJ, nome, UF ou Unidade TC" autoFocus />
        <button type="button" className="form-button-primary" disabled={!selectedId || selecting !== null} onClick={() => selectedId && selectOrganization(selectedId)}>{selecting ? "Abrindo..." : "Acessar empresa"}</button>
      </div>
      <div className="max-h-[62vh] overflow-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="sticky top-0 z-10 border-b border-cyan-200 bg-cyan-50 text-xs uppercase text-slate-600"><tr><th className="w-12 px-3 py-3"><span className="sr-only">Selecionar</span></th><th className="w-44 px-4 py-3">CNPJ</th><th className="px-4 py-3">Nome</th><th className="w-20 px-4 py-3">UF</th><th className="w-32 px-4 py-3">Código IBGE</th><th className="w-32 px-4 py-3">Ambiente</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {visibleOrganizations.map((organization, index) => <tr key={organization.id} onClick={() => setSelectedId(organization.id)} onDoubleClick={() => selectOrganization(organization.id)} className={`cursor-pointer transition ${selectedId === organization.id ? "bg-cyan-100" : index % 2 ? "bg-slate-50 hover:bg-cyan-50" : "bg-white hover:bg-cyan-50"}`}>
              <td className="px-3 py-2.5 text-center"><input type="radio" name="organization" checked={selectedId === organization.id} onChange={() => setSelectedId(organization.id)} aria-label={`Selecionar ${organization.name}`} /></td>
              <td className="px-4 py-2.5 font-medium text-slate-700">{formatDocument(organization.document)}</td><td className="px-4 py-2.5 font-semibold text-slate-900">{organization.name}</td><td className="px-4 py-2.5 text-slate-700">{organization.state || "-"}</td><td className="px-4 py-2.5 text-slate-700">{organization.code}</td><td className="px-4 py-2.5"><span className={`rounded-md px-2 py-1 text-xs font-semibold ${organization.environment === "demonstration" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>{organization.environment === "demonstration" ? "DEMO" : "PRODUÇÃO"}</span></td>
            </tr>)}
            {!loading && visibleOrganizations.length === 0 && <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={6}>Nenhuma empresa encontrada.</td></tr>}
            {loading && <tr><td className="px-4 py-10 text-center text-slate-500" colSpan={6}>Carregando empresas...</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-2 text-right text-xs font-medium text-slate-600">Registro(s): {visibleOrganizations.length}</div>
    </section>
  </section></main>;
}

function formatDocument(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 14);
  if (digits.length !== 14) return value || "-";
  return digits.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
}
