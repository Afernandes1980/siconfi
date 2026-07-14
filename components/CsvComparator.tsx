"use client";

import { useEffect, useMemo, useState } from "react";
import { toCsv, type ParsedCsv } from "@/lib/csv";
import { parseSpreadsheet } from "@/lib/spreadsheet";
import { parseCsvOrZip } from "@/lib/zip-csv";
import {
  validateFiscalFile,
  type FiscalValidationIssue,
  type FiscalValidationResult,
} from "@/lib/fiscal-validation";
import {
  compareCsvRows,
  resultRowsToCsvRows,
  ruleLabel,
  statusLabel,
  summarizeResults,
  type ComparisonRuleKind,
  type FieldMapping,
} from "@/lib/comparison";

const EMPTY_CSV: ParsedCsv = { headers: [], rows: [], delimiter: ";" };
const RESULT_HEADERS = [
  "chave",
  "status",
  "coluna_arquivo_a",
  "coluna_arquivo_b",
  "regra",
  "valor_arquivo_a",
  "valor_arquivo_b",
  "detalhe",
];

const RULES: ComparisonRuleKind[] = ["equals", "equalsIgnoreCase", "contains", "number", "date"];

type StoredComparisonRule = {
  id: number;
  dimension: string;
  code: string;
  item: string;
  status: string;
};

type RulesSummary = {
  dimension: string;
  status: string;
  total: number;
};

type ComparisonRuleCheck = {
  ruleCode: string;
  periodIndex: number;
  completedDate: string;
};

type PeriodicityKey = "monthly" | "bimonthly" | "four_monthly" | "annual";
type RulePeriodicity = { key: PeriodicityKey; label: string; periods: number; periodLabel: string };
type ComparisonRulePeriodicity = { ruleCode: string; periodicity: PeriodicityKey };

type OfficialFiscalDocument = {
  id: string;
  title: string;
  report: "RREO" | "RGF";
  kind: "validation" | "instructions";
  exercise: 2026;
  fileName: string;
  officialPath: string;
};

type OfficialFiscalRule = {
  code: string;
  report: "RREO" | "RGF" | "RREO/RGF";
  category: string;
  severity: "erro" | "aviso";
  description: string;
  sourceDocumentIds: string[];
  packageLabel: string;
};

type PcaspAccount = {
  account: string;
  title: string;
  balanceNature: string;
  normalizedNature: "D" | "C" | "D/C" | "";
};

type AccountNatureIssue = {
  rowNumber: number;
  account: string;
  comparisonKey: string;
  accountClass: string;
  expectedNature: string;
  actualNature: string;
  valueType: string;
  status: "Correto" | "Invertido";
};

type AccountNatureValidation = {
  rows: AccountNatureIssue[];
  checked: number;
  withoutNature: number;
  ignoredType: number;
  ignoredZeroBalance: number;
  inverted: number;
  correct: number;
  columns: {
    account: string;
    value: string;
    valueType: string;
    nature: string;
  };
};

type AccountNatureFilter = "todas" | "corretas" | "invertidas";

export default function CsvComparator({
  currentUser,
}: {
  currentUser: { displayName: string; email: string };
}) {
  const [sourceCsv, setSourceCsv] = useState<ParsedCsv>(EMPTY_CSV);
  const [targetCsv, setTargetCsv] = useState<ParsedCsv>(EMPTY_CSV);
  const [sourceName, setSourceName] = useState("");
  const [targetName, setTargetName] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [storedRules, setStoredRules] = useState<StoredComparisonRule[]>([]);
  const [rulesSummary, setRulesSummary] = useState<RulesSummary[]>([]);
  const [ruleChecks, setRuleChecks] = useState<ComparisonRuleCheck[]>([]);
  const [rulePeriodicities, setRulePeriodicities] = useState<ComparisonRulePeriodicity[]>([]);
  const [editingRule, setEditingRule] = useState<StoredComparisonRule | null>(null);
  const [editingPeriodicity, setEditingPeriodicity] = useState<PeriodicityKey>("annual");
  const [editingDates, setEditingDates] = useState<string[]>([]);
  const [savingChecks, setSavingChecks] = useState(false);
  const [checksError, setChecksError] = useState("");
  const [rulesLoading, setRulesLoading] = useState(true);
  const [fileError, setFileError] = useState("");
  const [rulesSearch, setRulesSearch] = useState("");
  const [selectedDimension, setSelectedDimension] = useState("todas");
  const [showAccountNature, setShowAccountNature] = useState(true);
  const [accountNatureFilter, setAccountNatureFilter] = useState<AccountNatureFilter>("todas");
  const [officialFiscalDocuments, setOfficialFiscalDocuments] = useState<OfficialFiscalDocument[]>([]);
  const [officialFiscalRules, setOfficialFiscalRules] = useState<OfficialFiscalRule[]>([]);
  const [pcaspAccounts, setPcaspAccounts] = useState<PcaspAccount[]>([]);

  const canCompare = sourceCsv.rows.length > 0 && targetCsv.rows.length > 0 && sourceKey && targetKey;

  const results = useMemo(() => {
    if (!canCompare) return [];
    return compareCsvRows(sourceCsv.rows, targetCsv.rows, { sourceKey, targetKey, mappings });
  }, [canCompare, mappings, sourceCsv.rows, sourceKey, targetCsv.rows, targetKey]);

  const summary = useMemo(() => summarizeResults(results), [results]);
  const previewResults = results.slice(0, 60);
  const ruleDimensions = useMemo(
    () => [...new Set(rulesSummary.map((item) => item.dimension))],
    [rulesSummary],
  );
  const visibleRules = useMemo(() => {
    const search = normalizeSearch(rulesSearch);

    return storedRules.filter((rule) => {
      const matchesDimension = selectedDimension === "todas" || rule.dimension === selectedDimension;
      const searchable = normalizeSearch(`${rule.dimension} ${rule.code} ${rule.item} ${rule.status}`);
      return matchesDimension && (!search || searchable.includes(search));
    });
  }, [rulesSearch, selectedDimension, storedRules]);
  const checksByRule = useMemo(() => {
    const checks = new Map<string, Map<number, string>>();
    ruleChecks.forEach((check) => {
      const periods = checks.get(check.ruleCode) ?? new Map<number, string>();
      periods.set(Number(check.periodIndex), check.completedDate);
      checks.set(check.ruleCode, periods);
    });
    return checks;
  }, [ruleChecks]);
  const periodicityByRule = useMemo(
    () => new Map(rulePeriodicities.map((item) => [item.ruleCode, item.periodicity])),
    [rulePeriodicities],
  );
  const accountNatureValidation = useMemo(
    () => validateAccountNatures(sourceCsv, pcaspAccounts),
    [pcaspAccounts, sourceCsv],
  );
  const fiscalValidation = useMemo(
    () => validateFiscalFile(targetCsv, targetName),
    [targetCsv, targetName],
  );
  const accountNatureRows = accountNatureValidation.rows;
  const accountNatureIssues = accountNatureRows.filter((row) => row.status === "Invertido");
  const filteredAccountNatureRows = useMemo(() => {
    if (accountNatureFilter === "corretas") {
      return accountNatureRows.filter((row) => row.status === "Correto");
    }

    if (accountNatureFilter === "invertidas") {
      return accountNatureIssues;
    }

    return accountNatureRows;
  }, [accountNatureFilter, accountNatureIssues, accountNatureRows]);

  useEffect(() => {
    let active = true;

    fetch("/api/comparison-rules", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: {
        rules: StoredComparisonRule[];
        summary: RulesSummary[];
        checks: ComparisonRuleCheck[];
        periodicities: ComparisonRulePeriodicity[];
        officialFiscal?: {
          documents: OfficialFiscalDocument[];
          rules: OfficialFiscalRule[];
        };
      }) => {
        if (!active) return;
        setStoredRules(data.rules ?? []);
        setRulesSummary(data.summary ?? []);
        setRuleChecks(data.checks ?? []);
        setRulePeriodicities(data.periodicities ?? []);
        setOfficialFiscalDocuments(data.officialFiscal?.documents ?? []);
        setOfficialFiscalRules(data.officialFiscal?.rules ?? []);
      })
      .catch(() => {
        if (!active) return;
        setStoredRules([]);
        setRulesSummary([]);
        setRuleChecks([]);
        setRulePeriodicities([]);
        setOfficialFiscalDocuments([]);
        setOfficialFiscalRules([]);
      })
      .finally(() => {
        if (active) setRulesLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    fetch("/api/pcasp-accounts", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { accounts: PcaspAccount[] }) => {
        if (active) setPcaspAccounts(data.accounts ?? []);
      })
      .catch(() => {
        if (active) setPcaspAccounts([]);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleFile(file: File, side: "source" | "target") {
    setFileError("");
    const imported = side === "target"
      ? { parsed: await parseSpreadsheet(file), importedName: file.name }
      : await parseCsvOrZip(file, { hasHeader: true, headerRowIndex: 1, dataStartRowIndex: 2 });

    if (side === "source") {
      setSourceCsv(imported.parsed);
      setSourceName(imported.importedName);
      setSourceKey(imported.parsed.headers[0] ?? "");
      setMappings((current) => current.filter((mapping) => imported.parsed.headers.includes(mapping.sourceColumn)));
      return;
    }

    setTargetCsv(imported.parsed);
    setTargetName(file.name);
    setTargetKey(imported.parsed.headers[0] ?? "");
    setMappings((current) => current.filter((mapping) => imported.parsed.headers.includes(mapping.targetColumn)));
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  function openRuleChecks(rule: StoredComparisonRule, selected?: PeriodicityKey) {
    const periodicity = getRulePeriodicity(selected ?? periodicityByRule.get(rule.code) ?? inferRulePeriodicity(rule.item));
    const savedDates = checksByRule.get(rule.code);
    setEditingRule(rule);
    setEditingPeriodicity(periodicity.key);
    setEditingDates(Array.from({ length: periodicity.periods }, (_, index) => savedDates?.get(index + 1) ?? ""));
    setChecksError("");
  }

  async function saveRuleChecks() {
    if (!editingRule) return;
    setSavingChecks(true);
    setChecksError("");
    try {
      const response = await fetch("/api/comparison-rules/checks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleCode: editingRule.code, periodicity: editingPeriodicity, dates: editingDates }),
      });
      if (!response.ok) throw new Error("Nao foi possivel salvar as datas.");
      setRuleChecks((current) => [
        ...current.filter((check) => check.ruleCode !== editingRule.code),
        ...editingDates.flatMap((completedDate, index) => completedDate
          ? [{ ruleCode: editingRule.code, periodIndex: index + 1, completedDate }]
          : []),
      ]);
      setRulePeriodicities((current) => [
        ...current.filter((item) => item.ruleCode !== editingRule.code),
        { ruleCode: editingRule.code, periodicity: editingPeriodicity },
      ]);
      setEditingRule(null);
    } catch (error) {
      setChecksError(error instanceof Error ? error.message : "Nao foi possivel salvar as datas.");
    } finally {
      setSavingChecks(false);
    }
  }

  async function handleFileSafely(file: File, side: "source" | "target") {
    try {
      await handleFile(file, side);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Nao foi possivel importar o arquivo.");
    }
  }

  function addMapping() {
    const sourceColumn = sourceCsv.headers.find((header) => header !== sourceKey) ?? sourceCsv.headers[0] ?? "";
    const targetColumn = targetCsv.headers.find((header) => header !== targetKey) ?? targetCsv.headers[0] ?? "";

    if (!sourceColumn || !targetColumn) return;

    setMappings((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        sourceColumn,
        targetColumn,
        rule: "equals",
        tolerance: 0,
      },
    ]);
  }

  function updateMapping(id: string, patch: Partial<FieldMapping>) {
    setMappings((current) =>
      current.map((mapping) => (mapping.id === id ? { ...mapping, ...patch } : mapping)),
    );
  }

  function removeMapping(id: string) {
    setMappings((current) => current.filter((mapping) => mapping.id !== id));
  }

  function exportResults() {
    const csvRows = resultRowsToCsvRows(results);
    const content = toCsv(csvRows, RESULT_HEADERS);
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "comparacao-csv.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-background">
      <section className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase text-cyan-700">Siconfi</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Análise do Ranking Municipal - STN
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Configure a chave que liga os arquivos, escolha os campos comparados e aplique regras
              por mapeamento.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold text-slate-800">{currentUser.displayName}</p>
              <p className="text-xs text-slate-500">{currentUser.email}</p>
            </div>
            <button type="button" className="form-button-secondary" onClick={handleLogout}>
              Sair
            </button>
            <button
              type="button"
              className="form-button-primary"
              disabled={results.length === 0}
              onClick={exportResults}
            >
              Exportar resultado
            </button>
          </div>
        </header>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <FilePanel
            title="MATRIZ"
            fileKind="csv"
            fileName={sourceName}
            parsedCsv={sourceCsv}
            selectedKey={sourceKey}
            onFile={(file) => handleFileSafely(file, "source")}
            onKeyChange={setSourceKey}
          />
          <FilePanel
            title="FISCAL"
            fileKind="xls"
            fileName={targetName}
            parsedCsv={targetCsv}
            selectedKey={targetKey}
            onFile={(file) => handleFileSafely(file, "target")}
            onKeyChange={setTargetKey}
          />
        </div>

        {fileError && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {fileError}
          </div>
        )}

        <FiscalRulesPanel
          validation={fiscalValidation}
          documents={officialFiscalDocuments}
          rules={officialFiscalRules}
          hasFiscalFile={targetCsv.rows.length > 0 || targetCsv.headers.length > 0}
        />

        <section className="panel mt-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Natureza das contas contabeis</h2>
              <p className="mt-1 text-sm text-slate-500">
                Valida todas as contas da Matriz usando a natureza oficial do PCASP Estendido 2026.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-full bg-slate-100 p-1 shadow-inner shadow-slate-200">
                {[
                  { label: "Exibir", value: true },
                  { label: "Recolher", value: false },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      showAccountNature === option.value
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                    onClick={() => setShowAccountNature(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-right">
                <p className="text-xs font-semibold uppercase text-rose-700">Invertidas</p>
                <p className="mt-1 text-2xl font-semibold text-rose-950">{accountNatureValidation.inverted}</p>
              </div>
            </div>
          </div>

          {showAccountNature && (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-500">Conta</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">
                    {accountNatureValidation.columns.account || "CONTA"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-500">Valor</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">
                    {accountNatureValidation.columns.value || "Valor"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-500">Tipo</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">
                    {accountNatureValidation.columns.valueType || "TIPO_VALOR"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-500">Natureza</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">
                    {accountNatureValidation.columns.nature || "NATUREZA_VALOR"}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <DataPoint label="Linhas da Matriz" value={sourceCsv.rows.length} />
                <DataPoint label="Contas analisadas" value={accountNatureValidation.checked} />
                <DataPoint label="Corretas" value={accountNatureValidation.correct} />
                <DataPoint label="Invertidas" value={accountNatureValidation.inverted} />
                <DataPoint label="Sem natureza" value={accountNatureValidation.withoutNature} />
                <DataPoint label="Fora de ending_balance" value={accountNatureValidation.ignoredType} />
                <DataPoint label="Saldo zero ignorado" value={accountNatureValidation.ignoredZeroBalance} />
              </div>

              <div className="mt-4 inline-flex rounded-full bg-slate-100 p-1 shadow-inner shadow-slate-200">
                {[
                  { label: "Todas", value: "todas" },
                  { label: "Corretas", value: "corretas" },
                  { label: "Invertidas", value: "invertidas" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      accountNatureFilter === option.value
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                    onClick={() => setAccountNatureFilter(option.value as AccountNatureFilter)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {sourceCsv.rows.length > 0 && accountNatureValidation.checked === 0 && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                  A Matriz foi importada, mas nao foi possivel identificar valores validos na coluna P. Verifique se a coluna P esta selecionada corretamente.
                </div>
              )}

              <div className="mt-4 max-h-72 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-200">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="w-24 px-4 py-3">Linha</th>
                      <th className="px-4 py-3">Conta</th>
                      <th className="px-4 py-3">Conta + tipo</th>
                      <th className="w-28 px-4 py-3">PCASP</th>
                      <th className="w-28 px-4 py-3">Esperado</th>
                      <th className="w-28 px-4 py-3">Natureza</th>
                      <th className="w-28 px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAccountNatureRows.map((issue) => (
                      <tr
                        key={`${issue.rowNumber}-${issue.account}-${issue.actualNature}`}
                        className={issue.status === "Invertido" ? "bg-rose-50 text-rose-800" : "text-slate-700"}
                      >
                        <td className="px-4 py-3 font-semibold">{issue.rowNumber}</td>
                        <td className="break-words px-4 py-3 font-semibold">{issue.account}</td>
                        <td className="break-words px-4 py-3 font-semibold">{issue.comparisonKey}</td>
                        <td className="px-4 py-3 font-bold">{issue.accountClass}</td>
                        <td className="px-4 py-3 font-bold">{issue.expectedNature}</td>
                        <td className="px-4 py-3 font-bold">{issue.actualNature || "-"}</td>
                        <td className="px-4 py-3 font-bold">{issue.status}</td>
                      </tr>
                    ))}
                    {filteredAccountNatureRows.length === 0 && (
                      <tr>
                        <td className="px-4 py-8 text-center text-slate-500" colSpan={7}>
                          Nenhuma conta para este filtro.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="panel mt-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Regras salvas no banco</h2>
              <p className="mt-1 text-sm text-slate-500">
                Checklist STN importado para SQLite e disponivel para orientar os mapeamentos.
              </p>
            </div>
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-right">
              <p className="text-xs font-semibold uppercase text-cyan-700">Total</p>
              <p className="mt-1 text-2xl font-semibold text-cyan-950">
                {rulesLoading ? "..." : storedRules.length}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {ruleDimensions.map((dimension) => (
              <DataPoint
                key={dimension}
                label={dimension}
                value={rulesSummary
                  .filter((item) => item.dimension === dimension)
                  .reduce((total, item) => total + item.total, 0)}
              />
            ))}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr]">
            <select
              className="form-field"
              value={selectedDimension}
              onChange={(event) => setSelectedDimension(event.target.value)}
            >
              <option value="todas">Todas as dimensoes</option>
              {ruleDimensions.map((dimension) => (
                <option key={dimension} value={dimension}>
                  {dimension}
                </option>
              ))}
            </select>
            <input
              className="form-field"
              value={rulesSearch}
              onChange={(event) => setRulesSearch(event.target.value)}
              placeholder="Buscar por codigo, regra, dimensao ou status"
            />
          </div>

          <div className="mt-4 max-h-96 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[1050px] table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[8%]" />
                <col className="w-[10%]" />
                <col className="w-[14%]" />
                <col className="w-[35%]" />
                <col className="w-[25%]" />
                <col className="w-[5%]" />
                <col className="w-[3%]" />
              </colgroup>
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Dimensao</th>
                  <th className="px-4 py-3">Codigo</th>
                  <th className="px-4 py-3">Periodicidade</th>
                  <th className="px-4 py-3">Regra</th>
                  <th className="px-4 py-3">Periodos</th>
                  <th className="px-2 py-3">Status</th>
                  <th className="px-2 py-3"><span className="sr-only">Acoes</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRules.map((rule) => {
                  const selectedPeriodicity = periodicityByRule.get(rule.code) ?? inferRulePeriodicity(rule.item);
                  const periodicity = getRulePeriodicity(selectedPeriodicity);
                  const savedPeriods = checksByRule.get(rule.code);
                  return (
                  <tr key={rule.id} className="hover:bg-slate-50">
                    <td className="break-words px-4 py-3 font-semibold text-slate-800">{rule.dimension}</td>
                    <td className="break-words px-4 py-3 font-medium text-slate-950">{rule.code}</td>
                    <td className="px-4 py-3">
                      <select
                        className="form-field min-w-0 max-w-full"
                        aria-label={`Periodicidade da regra ${rule.code}`}
                        value={selectedPeriodicity}
                        onChange={(event) => openRuleChecks(rule, event.target.value as PeriodicityKey)}
                      >
                        <option value="monthly">Mensal</option>
                        <option value="bimonthly">Bimestral</option>
                        <option value="four_monthly">Quadrimestral</option>
                        <option value="annual">Anual</option>
                      </select>
                    </td>
                    <td className="whitespace-normal break-words px-4 py-3 leading-relaxed text-slate-600">{rule.item}</td>
                    <td className="overflow-hidden px-4 py-3">
                      {periodicity.periods > 0 ? (
                        <div className="flex w-full gap-1" aria-label={`${periodicity.periods} periodos`}>
                          {Array.from({ length: periodicity.periods }, (_, index) => {
                            const date = savedPeriods?.get(index + 1);
                            return (
                              <span
                                key={index}
                                title={date ? `${index + 1}º ${periodicity.periodLabel}: ${formatDate(date)}` : `${index + 1}º ${periodicity.periodLabel}: pendente`}
                                className={`flex h-7 min-w-0 flex-1 items-center justify-center rounded-md border text-sm font-bold ${
                                  date
                                    ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                                    : "border-rose-300 bg-rose-50 text-rose-600"
                                }`}
                              >
                                {date ? "✓" : "×"}
                              </span>
                            );
                          })}
                        </div>
                      ) : <span className="text-xs text-slate-400">Sem períodos</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-3">
                      <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        {rule.status}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-center">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-lg font-bold leading-none text-slate-600 hover:border-cyan-600 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-40"
                        title={periodicity.periods ? "Informar datas" : "Periodicidade não identificada"}
                        onClick={() => openRuleChecks(rule)}
                      >
                        …
                      </button>
                    </td>
                  </tr>
                  );
                })}
                {!rulesLoading && visibleRules.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={7}>
                      Nenhuma regra encontrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {editingRule && (
          <RuleChecksDialog
            rule={editingRule}
            periodicityKey={editingPeriodicity}
            dates={editingDates}
            error={checksError}
            saving={savingChecks}
            onChange={setEditingDates}
            onClose={() => setEditingRule(null)}
            onSave={saveRuleChecks}
          />
        )}

        <section className="panel mt-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Mapeamentos</h2>
              <p className="mt-1 text-sm text-slate-500">
                Cada linha indica onde o arquivo A busca no arquivo B e qual regra deve validar.
              </p>
            </div>
            <button
              type="button"
              className="form-button-secondary"
              disabled={sourceCsv.headers.length === 0 || targetCsv.headers.length === 0}
              onClick={addMapping}
            >
              Adicionar regra
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1">Coluna A</th>
                  <th className="px-2 py-1">Coluna B</th>
                  <th className="px-2 py-1">Regra</th>
                  <th className="px-2 py-1">Tolerancia</th>
                  <th className="px-2 py-1 text-right">Acao</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr key={mapping.id} className="bg-slate-50">
                    <td className="rounded-l-lg px-2 py-2">
                      <SelectField
                        value={mapping.sourceColumn}
                        options={sourceCsv.headers}
                        onChange={(value) => updateMapping(mapping.id, { sourceColumn: value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <SelectField
                        value={mapping.targetColumn}
                        options={targetCsv.headers}
                        onChange={(value) => updateMapping(mapping.id, { targetColumn: value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        className="form-field"
                        value={mapping.rule}
                        onChange={(event) =>
                          updateMapping(mapping.id, { rule: event.target.value as ComparisonRuleKind })
                        }
                      >
                        {RULES.map((rule) => (
                          <option key={rule} value={rule}>
                            {ruleLabel(rule)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        className="form-field"
                        disabled={mapping.rule !== "number"}
                        min="0"
                        step="0.01"
                        type="number"
                        value={mapping.tolerance ?? 0}
                        onChange={(event) =>
                          updateMapping(mapping.id, { tolerance: Number(event.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="rounded-r-lg px-2 py-2 text-right">
                      <button
                        type="button"
                        className="rounded-lg px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                        onClick={() => removeMapping(mapping.id)}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
                {mappings.length === 0 && (
                  <tr>
                    <td className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500" colSpan={5}>
                      Nenhum mapeamento definido. Sem regras, a comparacao valida apenas a existencia das chaves.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-5 grid gap-4 md:grid-cols-4">
          <SummaryCard label="Conferidos" value={summary.ok} tone="emerald" />
          <SummaryCard label="Divergentes" value={summary.different} tone="amber" />
          <SummaryCard label="Ausentes no B" value={summary.missingTarget} tone="rose" />
          <SummaryCard label="Ausentes no A" value={summary.missingSource} tone="slate" />
        </section>

        <section className="panel mt-5 overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-950">Resultado</h2>
            <p className="mt-1 text-sm text-slate-500">
              {summary.total > 0 ? `${summary.total} chaves analisadas.` : "Carregue os arquivos para iniciar."}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Chave</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Divergencias</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewResults.map((result) => (
                  <tr key={`${result.key}-${result.status}`}>
                    <td className="max-w-56 truncate px-4 py-3 font-medium text-slate-950">{result.key || "(vazio)"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={result.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {result.issues.length > 0
                        ? result.issues.map((issue) => issue.message).join(" | ")
                        : statusLabel(result.status)}
                    </td>
                  </tr>
                ))}
                {previewResults.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={3}>
                      Nenhum resultado para exibir.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function inferRulePeriodicity(item: string): PeriodicityKey {
  const text = normalizeSearch(item);
  if (text.includes("dca") || text.includes("anual")) {
    return "annual";
  }
  if (text.includes("rgf") || text.includes("quadrimestr")) {
    return "four_monthly";
  }
  if (text.includes("rreo") || text.includes("bimestr")) {
    return "bimonthly";
  }
  return "annual";
}

function getRulePeriodicity(key: PeriodicityKey): RulePeriodicity {
  const periodicities: Record<PeriodicityKey, RulePeriodicity> = {
    monthly: { key: "monthly", label: "Mensal", periods: 12, periodLabel: "Mês" },
    bimonthly: { key: "bimonthly", label: "Bimestral", periods: 6, periodLabel: "Bimestre" },
    four_monthly: { key: "four_monthly", label: "Quadrimestral", periods: 3, periodLabel: "Quadrimestre" },
    annual: { key: "annual", label: "Anual", periods: 1, periodLabel: "Ano" },
  };
  return periodicities[key];
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function RuleChecksDialog({
  rule,
  periodicityKey,
  dates,
  error,
  saving,
  onChange,
  onClose,
  onSave,
}: {
  rule: StoredComparisonRule;
  periodicityKey: PeriodicityKey;
  dates: string[];
  error: string;
  saving: boolean;
  onChange: (dates: string[]) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const periodicity = getRulePeriodicity(periodicityKey);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-checks-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="rule-checks-title" className="text-lg font-semibold text-slate-950">Datas de verificação</h2>
            <p className="mt-1 text-sm text-slate-500">{rule.code} · {periodicity.label}</p>
          </div>
          <button type="button" className="rounded-md px-2 py-1 text-xl text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-700">{rule.item}</p>
        <div className="mt-5 space-y-3">
          {dates.map((date, index) => (
            <label key={index} className="grid items-center gap-2 sm:grid-cols-[1fr_190px]">
              <span className="text-sm font-semibold text-slate-700">{index + 1}º {periodicity.periodLabel}</span>
              <span className="flex items-center gap-2">
                <input
                  type="date"
                  className="form-field"
                  value={date}
                  onChange={(event) => onChange(dates.map((current, currentIndex) => currentIndex === index ? event.target.value : current))}
                />
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-bold ${date ? "border-emerald-300 bg-emerald-100 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-600"}`}>
                  {date ? "✓" : "×"}
                </span>
              </span>
            </label>
          ))}
        </div>
        {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="form-button-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="form-button-primary" disabled={saving} onClick={onSave}>{saving ? "Salvando..." : "Salvar datas"}</button>
        </div>
      </section>
    </div>
  );
}

function FiscalRulesPanel({
  validation,
  documents,
  rules,
  hasFiscalFile,
}: {
  validation: FiscalValidationResult;
  documents: OfficialFiscalDocument[];
  rules: OfficialFiscalRule[];
  hasFiscalFile: boolean;
}) {
  const previewIssues = validation.issues.slice(0, 80);
  const packageLabel = rules[0]?.packageLabel ?? "Pacote oficial Siconfi RREO/RGF 2026";

  return (
    <section className="panel mt-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Validador Fiscal 2026</h2>
          <p className="mt-1 text-sm text-slate-500">
            {packageLabel} aplicado ao arquivo importado em FISCAL.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <DataPoint label="Linhas" value={validation.checkedRows} />
          <DataPoint label="Erros" value={validation.errors} />
          <DataPoint label="Avisos" value={validation.warnings} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold uppercase text-slate-500">Detectado</p>
          <p className="mt-1 text-xl font-semibold text-slate-950">{validation.detectedReport}</p>
        </div>
        {documents.map((document) => (
          <div key={document.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase text-slate-500">
              {document.report} {document.kind === "validation" ? "Validacao" : "Instrucoes"}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{document.fileName}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        {rules.map((rule) => (
          <div key={rule.code} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase text-slate-500">{rule.category}</p>
              <span
                className={`rounded-md px-2 py-1 text-xs font-semibold ${
                  rule.severity === "erro"
                    ? "bg-rose-100 text-rose-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {rule.severity}
              </span>
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-900">{rule.code}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{rule.description}</p>
          </div>
        ))}
      </div>

      {!hasFiscalFile && (
        <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-medium text-cyan-800">
          Importe o XLS/XLSX em FISCAL para executar as regras 2026.
        </div>
      )}

      {hasFiscalFile && validation.issues.length === 0 && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Nenhuma divergencia estrutural encontrada no arquivo Fiscal importado.
        </div>
      )}

      {previewIssues.length > 0 && (
        <div className="mt-4 max-h-80 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-200">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-28 px-4 py-3">Regra</th>
                <th className="w-24 px-4 py-3">Sev.</th>
                <th className="w-40 px-4 py-3">Aba</th>
                <th className="w-24 px-4 py-3">Linha</th>
                <th className="w-44 px-4 py-3">Coluna</th>
                <th className="px-4 py-3">Ocorrencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {previewIssues.map((issue, index) => (
                <FiscalIssueRow key={`${issue.ruleCode}-${issue.sheetName}-${issue.rowNumber}-${issue.column}-${index}`} issue={issue} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FiscalIssueRow({ issue }: { issue: FiscalValidationIssue }) {
  return (
    <tr className={issue.severity === "erro" ? "bg-rose-50 text-rose-800" : "text-slate-700"}>
      <td className="break-words px-4 py-3 text-xs font-semibold">{issue.ruleCode}</td>
      <td className="px-4 py-3 font-bold">{issue.severity}</td>
      <td className="break-words px-4 py-3 font-semibold">{issue.sheetName ?? "-"}</td>
      <td className="px-4 py-3 font-semibold">{issue.rowNumber ?? "-"}</td>
      <td className="break-words px-4 py-3 font-semibold">{issue.column ?? "-"}</td>
      <td className="break-words px-4 py-3">{issue.message}</td>
    </tr>
  );
}

function validateAccountNatures(csv: ParsedCsv, pcaspAccounts: PcaspAccount[]) {
  const accountColumn = findColumnByHeader(csv.headers, ["conta"], 0);
  const valueColumn = findColumnByHeader(csv.headers, ["valor"], 13);
  const valueTypeColumn = findColumnByHeader(csv.headers, ["tipo_valor", "tipovalor"], 14);
  const natureColumn = findColumnByHeader(csv.headers, ["natureza_valor", "naturezavalor"], 15);
  const emptyResult: AccountNatureValidation = {
    rows: [],
    checked: 0,
    withoutNature: 0,
    ignoredType: 0,
    ignoredZeroBalance: 0,
    inverted: 0,
    correct: 0,
    columns: {
      account: accountColumn,
      value: valueColumn,
      valueType: valueTypeColumn,
      nature: natureColumn,
    },
  };

  if (!accountColumn || pcaspAccounts.length === 0) {
    return emptyResult;
  }

  const pcaspIndex = buildPcaspIndex(pcaspAccounts);
  let checked = 0;
  let withoutNature = 0;
  let ignoredType = 0;
  let ignoredZeroBalance = 0;
  let inverted = 0;
  let correct = 0;
  const rows: AccountNatureIssue[] = [];

  for (const [index, row] of csv.rows.entries()) {
    const account = row[accountColumn] ?? "";
    const valueType = row[valueTypeColumn] ?? "";

    if (normalizeSearch(valueType) !== "ending_balance") {
      ignoredType += 1;
      continue;
    }

    const balance = parseFiscalNumber(row[valueColumn] ?? "");
    if (balance === 0) {
      ignoredZeroBalance += 1;
      continue;
    }

    const actualNature = extractNature(row[natureColumn] ?? "");

    if (!actualNature) {
      withoutNature += 1;
      continue;
    }

    const pcaspAccount = findPcaspAccount(account, pcaspIndex);
    const expectedNature = pcaspAccount?.balanceNature ?? "Nao encontrada no PCASP";
    const status = pcaspAccount && acceptsNature(pcaspAccount.normalizedNature, actualNature)
      ? "Correto"
      : "Invertido";

    checked += 1;

    if (status === "Invertido") inverted += 1;
    if (status === "Correto") correct += 1;

    rows.push({
      rowNumber: Number(row.__rowNumber) || index + 3,
      account,
      comparisonKey: `${account} + ending_balance`,
      accountClass: pcaspAccount?.account ?? "-",
      expectedNature,
      actualNature,
      valueType,
      status,
    });
  }

  return {
    rows,
    checked,
    withoutNature,
    ignoredType,
    ignoredZeroBalance,
    inverted,
    correct,
    columns: {
      account: accountColumn,
      value: valueColumn,
      valueType: valueTypeColumn,
      nature: natureColumn,
    },
  };
}

function buildPcaspIndex(accounts: PcaspAccount[]) {
  return new Map(accounts.map((account) => [normalizeAccountCode(account.account), account]));
}

function findPcaspAccount(account: string, index: Map<string, PcaspAccount>) {
  const normalized = normalizeAccountCode(account);
  if (!normalized) return null;

  const exact = index.get(normalized);
  if (exact) return exact;

  for (let length = normalized.length - 1; length > 0; length -= 1) {
    const parent = normalized.slice(0, length).padEnd(normalized.length, "0");
    const match = index.get(parent);
    if (match) return match;
  }

  return null;
}

function acceptsNature(expected: PcaspAccount["normalizedNature"], actual: string) {
  if (expected === "D/C") return actual === "D" || actual === "C";
  return expected === actual;
}

function normalizeAccountCode(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? digits.padStart(9, "0") : "";
}

function findColumnByHeader(headers: string[], candidates: string[], fallbackIndex: number) {
  const normalizedCandidates = new Set(candidates.map(normalizeHeaderKey));
  return headers.find((header) => normalizedCandidates.has(normalizeHeaderKey(header))) ?? headers[fallbackIndex] ?? "";
}

function normalizeHeaderKey(value: string) {
  return normalizeSearch(value).replace(/[^a-z0-9]/g, "");
}

function parseFiscalNumber(value: string) {
  const cleaned = value.trim().replace(/\s/g, "");
  if (!cleaned) return null;

  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function extractNature(value: string) {
  const normalized = normalizeSearch(value);

  if (normalized === "d" || normalized.startsWith("d ") || normalized.includes("deved")) return "D";
  if (normalized === "c" || normalized.startsWith("c ") || normalized.includes("cred")) return "C";

  const token = normalized.match(/(?:^|[^a-z0-9])([dc])(?:[^a-z0-9]|$)/);
  if (token?.[1] === "d") return "D";
  if (token?.[1] === "c") return "C";

  return "";
}

function FilePanel({
  title,
  fileKind,
  fileName,
  parsedCsv,
  selectedKey,
  onFile,
  onKeyChange,
}: {
  title: string;
  fileKind: "csv" | "xls";
  fileName: string;
  parsedCsv: ParsedCsv;
  selectedKey: string;
  onFile: (file: File) => void;
  onKeyChange: (value: string) => void;
}) {
  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {fileName || `Selecione um arquivo ${fileKind === "xls" ? "XLS/XLSX" : "CSV ou ZIP"}`}
          </p>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
          {parsedCsv.delimiter === "\t" ? "tab" : parsedCsv.delimiter}
        </span>
      </div>

      <label className="mt-4 block">
        <span className="sr-only">Selecionar {title}</span>
        <input
          className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-cyan-700 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-cyan-800"
          type="file"
          accept={fileKind === "xls" ? ".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : ".csv,.zip,text/csv,application/zip,application/x-zip-compressed"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <DataPoint label="Colunas" value={parsedCsv.headers.length} />
        <DataPoint label="Linhas" value={parsedCsv.rows.length} />
        <div className="sm:col-span-1">
          <label className="text-xs font-semibold uppercase text-slate-500">Chave</label>
          <SelectField value={selectedKey} options={parsedCsv.headers} onChange={onKeyChange} />
        </div>
      </div>
    </section>
  );
}

function SelectField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <select className="form-field" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Selecione</option>
      {options.length === 0 && <option value="">Sem colunas</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function DataPoint({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose" | "slate";
}) {
  const styles = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    slate: "border-slate-200 bg-white text-slate-800",
  };

  return (
    <div className={`rounded-lg border px-4 py-3 shadow-sm ${styles[tone]}`}>
      <p className="text-xs font-semibold uppercase opacity-70">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: "ok" | "different" | "missing-target" | "missing-source" }) {
  const styles = {
    ok: "bg-emerald-100 text-emerald-800",
    different: "bg-amber-100 text-amber-800",
    "missing-target": "bg-rose-100 text-rose-800",
    "missing-source": "bg-slate-100 text-slate-700",
  };

  return (
    <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>
      {statusLabel(status)}
    </span>
  );
}
