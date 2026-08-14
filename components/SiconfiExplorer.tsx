"use client";

import { useMemo, useState, type ReactNode } from "react";

type Rule = { id: number; dimension: string; code: string; item: string; status: string };
type Resource = "msc_patrimonial" | "msc_orcamentaria" | "msc_controle" | "rreo" | "rgf" | "dca" | "extrato_entregas";
type ApiResponse = { items?: Record<string, unknown>[]; count?: number; hasMore?: boolean; error?: string };

const RESOURCES: [Resource, string][] = [
  ["msc_patrimonial", "MSC — Patrimonial"], ["msc_orcamentaria", "MSC — Orçamentária"],
  ["msc_controle", "MSC — Controle"], ["rreo", "RREO"], ["rgf", "RGF"],
  ["dca", "DCA"], ["extrato_entregas", "Extrato de entregas"],
];
const CLASSES: Partial<Record<Resource, string[]>> = {
  msc_patrimonial: ["1", "2", "3", "4"], msc_orcamentaria: ["5", "6"], msc_controle: ["7", "8"],
};

export default function SiconfiExplorer({ rules, organizationCode }: { rules: Rule[]; organizationCode: string }) {
  const dimensions = useMemo(() => [...new Set(rules.map((rule) => rule.dimension))], [rules]);
  const [dimension, setDimension] = useState(dimensions[0] ?? "1");
  const [ruleCode, setRuleCode] = useState("");
  const [resource, setResource] = useState<Resource>("msc_patrimonial");
  const [entityId, setEntityId] = useState(organizationCode);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [accountClass, setAccountClass] = useState("1");
  const [valueType, setValueType] = useState("ending_balance");
  const [matrixType, setMatrixType] = useState("MSCC");
  const [period, setPeriod] = useState("1");
  const [periodicity, setPeriodicity] = useState("Q");
  const [power, setPower] = useState("E");
  const [appendix, setAppendix] = useState("");
  const [offset, setOffset] = useState(0);
  const [response, setResponse] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const isMsc = resource.startsWith("msc_");
  const rows = response?.items ?? [];
  const columns = useMemo(() => [...new Set(rows.flatMap(Object.keys))], [rows]);
  const visibleRows = useMemo(() => {
    const term = normalize(search);
    return term ? rows.filter((row) => normalize(Object.values(row).join(" ")).includes(term)) : rows;
  }, [rows, search]);
  const totalValue = visibleRows.reduce((sum, row) => sum + (typeof row.valor === "number" ? row.valor : 0), 0);
  const selectedRule = rules.find((rule) => rule.code === ruleCode);

  function changeResource(next: Resource) {
    setResource(next); setAccountClass(CLASSES[next]?.[0] ?? "1"); setResponse(null); setOffset(0); setError("");
  }

  async function consult(nextOffset = 0) {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ id_ente: entityId, limit: "500", offset: String(nextOffset) });
      if (isMsc) {
        Object.entries({ an_referencia: year, me_referencia: month, co_tipo_matriz: matrixType, classe_conta: accountClass, id_tv: valueType }).forEach(([key, value]) => query.set(key, value));
      } else if (resource === "extrato_entregas") query.set("an_referencia", year);
      else {
        query.set("an_exercicio", year);
        if (resource === "rreo" || resource === "rgf") { query.set("nr_periodo", period); query.set("co_tipo_demonstrativo", resource.toUpperCase()); }
        if (resource === "rgf") { query.set("in_periodicidade", periodicity); query.set("co_poder", power); }
        if (appendix) query.set("no_anexo", appendix);
      }
      const result = await fetch(`/api/siconfi/${resource}?${query}`, { cache: "no-store" });
      const data = await result.json() as ApiResponse;
      if (!result.ok) throw new Error(data.error ?? "Não foi possível consultar o Siconfi.");
      setResponse(data); setOffset(nextOffset); setSearch("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível consultar o Siconfi."); }
    finally { setLoading(false); }
  }

  function exportCsv() {
    if (!visibleRows.length) return;
    const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [columns.map(quote).join(";"), ...visibleRows.map((row) => columns.map((column) => quote(row[column])).join(";"))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `siconfi-${resource}-${entityId}-${year}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  return <section className="mt-6 space-y-5">
    <section className="panel overflow-hidden">
      <div className="bg-gradient-to-r from-cyan-800 to-blue-950 px-6 py-5 text-white"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">Dados oficiais do Tesouro Nacional</p><h2 className="mt-2 text-2xl font-semibold">Central de avaliação Siconfi</h2><p className="mt-1 text-sm text-blue-100">Associe uma consulta a cada item do checklist e examine os registros usados na avaliação.</p></div>
      <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Dimensão"><select className="form-field" value={dimension} onChange={(event) => { setDimension(event.target.value); setRuleCode(""); }}>{dimensions.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Item do checklist"><select className="form-field" value={ruleCode} onChange={(event) => setRuleCode(event.target.value)}><option value="">Selecione o item</option>{rules.filter((rule) => rule.dimension === dimension).map((rule) => <option key={rule.code} value={rule.code}>{rule.code} — {rule.item}</option>)}</select></Field>
        <Field label="Conjunto de dados"><select className="form-field" value={resource} onChange={(event) => changeResource(event.target.value as Resource)}>{RESOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Código IBGE do ente"><input className="form-field" value={entityId} inputMode="numeric" onChange={(event) => setEntityId(event.target.value.replace(/\D/g, ""))} /></Field>
      </div>
      {selectedRule && <div className="mx-5 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm"><strong className="text-cyan-950">{selectedRule.code}</strong><span className="ml-2 text-slate-700">{selectedRule.item}</span></div>}
      <div className="grid gap-4 p-5 md:grid-cols-3 xl:grid-cols-6">
        <Field label="Exercício"><input className="form-field" type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} /></Field>
        {isMsc && <><Field label="Mês"><select className="form-field" value={month} onChange={(event) => setMonth(event.target.value)}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{String(index + 1).padStart(2, "0")}</option>)}</select></Field><Field label="Tipo da matriz"><select className="form-field" value={matrixType} onChange={(event) => setMatrixType(event.target.value)}><option>MSCC</option><option>MSCE</option></select></Field><Field label="Classe"><select className="form-field" value={accountClass} onChange={(event) => setAccountClass(event.target.value)}>{CLASSES[resource]?.map((item) => <option key={item}>{item}</option>)}</select></Field><Field label="Tipo do valor"><select className="form-field" value={valueType} onChange={(event) => setValueType(event.target.value)}><option value="beginning_balance">Saldo inicial</option><option value="period_change">Movimento</option><option value="ending_balance">Saldo final</option></select></Field></>}
        {(resource === "rreo" || resource === "rgf") && <Field label={resource === "rreo" ? "Bimestre" : "Período"}><select className="form-field" value={period} onChange={(event) => setPeriod(event.target.value)}>{Array.from({ length: resource === "rreo" ? 6 : 3 }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select></Field>}
        {resource === "rgf" && <><Field label="Periodicidade"><select className="form-field" value={periodicity} onChange={(event) => setPeriodicity(event.target.value)}><option value="Q">Quadrimestral</option><option value="S">Semestral</option></select></Field><Field label="Poder"><select className="form-field" value={power} onChange={(event) => setPower(event.target.value)}><option value="E">Executivo</option><option value="L">Legislativo</option><option value="J">Judiciário</option><option value="M">Ministério Público</option><option value="D">Defensoria</option></select></Field></>}
        {(resource === "rreo" || resource === "rgf" || resource === "dca") && <Field label="Anexo (opcional)"><input className="form-field" value={appendix} onChange={(event) => setAppendix(event.target.value)} placeholder="Ex.: RREO-Anexo 01" /></Field>}
        <div className="flex items-end"><button className="form-button-primary w-full" disabled={loading || !entityId || !year} onClick={() => consult(0)}>{loading ? "Consultando..." : "Consultar Siconfi"}</button></div>
      </div>{error && <p className="mx-5 mb-5 rounded-lg bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}
    </section>
    {response && <section className="panel overflow-hidden"><div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 p-4"><div className="mr-auto"><h3 className="font-semibold text-slate-950">Dados retornados</h3><p className="text-xs text-slate-500">{visibleRows.length} registro(s) · Soma do campo valor: {number(totalValue)}</p></div><input className="form-field min-w-60" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar nos resultados" /><button className="form-button-secondary" onClick={exportCsv} disabled={!visibleRows.length}>Exportar CSV</button></div>
      <div className="max-h-[62vh] overflow-auto"><table className="min-w-full whitespace-nowrap text-left text-xs"><thead className="sticky top-0 z-10 bg-cyan-50 text-slate-700"><tr>{columns.map((column) => <th key={column} className="border-b border-cyan-200 px-3 py-3">{column}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{visibleRows.map((row, index) => <tr key={index} className="even:bg-slate-50 hover:bg-cyan-50">{columns.map((column) => <td key={column} className="max-w-80 overflow-hidden text-ellipsis px-3 py-2.5 text-slate-700" title={String(row[column] ?? "")}>{typeof row[column] === "number" ? number(row[column] as number) : String(row[column] ?? "")}</td>)}</tr>)}</tbody></table>{!visibleRows.length && <p className="p-10 text-center text-sm text-slate-500">Nenhum registro encontrado.</p>}</div>
      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 p-3"><button className="form-button-secondary" disabled={loading || offset === 0} onClick={() => consult(Math.max(0, offset - 500))}>Anterior</button><span className="text-xs text-slate-600">Offset {offset} · {response.count ?? rows.length} registro(s)</span><button className="form-button-secondary" disabled={loading || !response.hasMore} onClick={() => consult(offset + 500)}>Próxima</button></div></section>}
  </section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="grid gap-1.5 text-xs font-semibold text-slate-700"><span>{label}</span>{children}</label>; }
function normalize(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function number(value: number) { return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 }).format(value); }
