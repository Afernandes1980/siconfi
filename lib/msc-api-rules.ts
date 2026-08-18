import { listPowerBodies, listResourceSources } from "@/lib/rules-db";
import { fetchSiconfi, type SiconfiResource } from "@/lib/siconfi-api";
import type { RreoDelivery } from "@/lib/rreo-timeliness";

type ApiRow = Record<string, unknown> & { conta_contabil?: string | number; poder_orgao?: string | number | null; fonte_recursos?: string | number | null; valor?: string | number | null; tipo_valor?: string | null; natureza_conta?: string | null };
type ApiResponse = { items?: ApiRow[]; hasMore?: boolean; limit?: number };
export type MscApiRuleResult = { ruleCode: "D1_00018" | "D1_00020" | "D1_00022" | "D1_00023" | "D1_00024" | "D1_00027" | "D1_00028"; passed: boolean; details: string; issues: string[] };
export type MscApiRulesEvaluation = { exercise: number; month: number | null; previousMonth: number | null; deliveryDate: string | null; checkedRows: number; rules: MscApiRuleResult[] };

const GROUPS: Array<{ resource: SiconfiResource; classes: string[] }> = [
  { resource: "msc_patrimonial", classes: ["1", "2", "3", "4"] },
  { resource: "msc_orcamentaria", classes: ["5", "6"] },
  { resource: "msc_controle", classes: ["7", "8"] },
];
const VALUE_TYPES = ["beginning_balance", "period_change", "ending_balance"];

export async function evaluateLatestMscApiRules(exercise: number, entityId: string, deliveries: RreoDelivery[]): Promise<MscApiRulesEvaluation> {
  const sent = deliveries.filter((item) => item.periodicidade === "M" && normalize(item.entregavel).includes("msc agregada") && item.data_status && Number(item.periodo) >= 1 && Number(item.periodo) <= 12);
  const latest = [...sent].sort((a, b) => String(b.data_status).localeCompare(String(a.data_status)))[0];
  if (!latest) return { exercise, month: null, previousMonth: null, deliveryDate: null, checkedRows: 0, rules: emptyRules() };
  const month = Number(latest.periodo);
  const previousMonth = Math.max(0, ...sent.map((item) => Number(item.periodo)).filter((period) => period < month)) || null;
  const [rows, previousRows, powerBodies, resourceSources] = await Promise.all([
    fetchMatrix(entityId, exercise, month),
    previousMonth ? fetchMatrix(entityId, exercise, previousMonth) : Promise.resolve([]),
    listPowerBodies(),
    listResourceSources(),
  ]);

  const validPowerCodes = new Set(powerBodies.map((item) => digits(item.code)));
  const invalidPowerCodes = unique(rows.map((row) => digits(row.poder_orgao)).filter((code) => code && !validPowerCodes.has(code)));
  const executiveCodes = new Set(powerBodies.filter((item) => normalize(item.name).includes("poder executivo")).map((item) => digits(item.code)));
  const usedExecutiveCodes = unique(rows.map((row) => digits(row.poder_orgao)).filter((code) => executiveCodes.has(code)));
  const executivePassed = usedExecutiveCodes.length <= 1 || usedExecutiveCodes.every((code) => code === "10131" || code === "10132");

  const legislativeCodes = new Set(powerBodies.filter((item) => normalize(item.name).includes("poder legislativo")).map((item) => digits(item.code)));
  const currentLegislative = signatureSet(rows.filter((row) => legislativeCodes.has(digits(row.poder_orgao))));
  const previousLegislative = signatureSet(previousRows.filter((row) => legislativeCodes.has(digits(row.poder_orgao))));
  const legislativeRepeated = previousMonth !== null && currentLegislative.size > 0 && setsEqual(currentLegislative, previousLegislative);

  const validSources = new Set(resourceSources.map((item) => digits(item.code)));
  const invalidSources = unique(rows.map((row) => digits(row.fonte_recursos)).filter((code) => code && !validSources.has(code)));
  const classCounts = new Map(Array.from({ length: 8 }, (_, index) => [String(index + 1), 0]));
  rows.forEach((row) => {
    const accountClass = digits(row.conta_contabil)[0];
    if (classCounts.has(accountClass) && Number(row.valor) !== 0) classCounts.set(accountClass, (classCounts.get(accountClass) ?? 0) + 1);
  });
  const missingClasses = [...classCounts].filter(([, count]) => count === 0).map(([accountClass]) => accountClass);
  const balanceComparison = compareBalances(rows, previousRows, previousMonth);
  const movementConsistency = compareMovement(rows);

  return { exercise, month, previousMonth, deliveryDate: latest.data_status ?? null, checkedRows: rows.length, rules: [
    { ruleCode: "D1_00018", passed: movementConsistency.differences === 0 && movementConsistency.compared > 0, details: `${movementConsistency.compared} chaves comparadas; ${movementConsistency.differences} inconsistências em SI + MOV = SF`, issues: movementConsistency.issues },
    { ruleCode: "D1_00020", passed: balanceComparison.differences === 0 && previousMonth !== null, details: previousMonth ? `${balanceComparison.compared} saldos comparados; ${balanceComparison.ignoredZero} saldos iniciais zero ignorados; ${balanceComparison.differences} diferenças` : "Sem competência anterior para comparação", issues: balanceComparison.issues },
    { ruleCode: "D1_00022", passed: invalidPowerCodes.length === 0, details: `${validPowerCodes.size} códigos oficiais usados como referência`, issues: invalidPowerCodes },
    { ruleCode: "D1_00023", passed: executivePassed, details: `Códigos executivos: ${usedExecutiveCodes.join(", ") || "nenhum"}`, issues: executivePassed ? [] : usedExecutiveCodes },
    { ruleCode: "D1_00024", passed: !legislativeRepeated, details: previousMonth ? `Comparação com ${String(previousMonth).padStart(2, "0")}/${exercise}` : "Sem competência anterior", issues: legislativeRepeated ? [`Dados legislativos repetidos em ${previousMonth} e ${month}`] : [] },
    { ruleCode: "D1_00027", passed: invalidSources.length === 0, details: `${validSources.size} fontes oficiais usadas como referência`, issues: invalidSources },
    { ruleCode: "D1_00028", passed: missingClasses.length === 0, details: "Classes 1 a 8 com valor diferente de zero", issues: missingClasses },
  ] };
}

async function fetchMatrix(entityId: string, exercise: number, month: number) {
  const rows: ApiRow[] = [];
  for (const group of GROUPS) for (const accountClass of group.classes) for (const valueType of VALUE_TYPES) {
    let offset = 0;
    do {
      const query = new URLSearchParams({ id_ente: entityId, an_referencia: String(exercise), me_referencia: String(month), co_tipo_matriz: "MSCC", classe_conta: accountClass, id_tv: valueType, limit: "5000", offset: String(offset) });
      const response = await fetchSiconfi(group.resource, query) as ApiResponse;
      const items = response.items ?? [];
      rows.push(...items);
      if (!response.hasMore || items.length === 0) break;
      offset += response.limit ?? items.length;
    } while (true);
  }
  return rows;
}

function signatureSet(rows: ApiRow[]) {
  return new Set(rows.map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !["exercicio", "mes_referencia", "data_referencia", "entrada_msc"].includes(key)).sort(([a], [b]) => a.localeCompare(b))))));
}
function compareBalances(currentRows: ApiRow[], previousRows: ApiRow[], previousMonth: number | null) {
  if (previousMonth === null) return { compared: 0, ignoredZero: 0, differences: 0, issues: [] as string[] };
  const endings = new Map(previousRows.filter((row) => row.tipo_valor === "ending_balance").map((row) => [balanceKey(row), row]));
  const beginnings = new Map(currentRows.filter((row) => row.tipo_valor === "beginning_balance").map((row) => [balanceKey(row), row]));
  const keys = new Set([...endings.keys(), ...beginnings.keys()]);
  let compared = 0;
  let ignoredZero = 0;
  let differences = 0;
  const issues: string[] = [];
  for (const key of keys) {
    const ending = endings.get(key);
    const beginning = beginnings.get(key);
    if (beginning && Number(beginning.valor) === 0) { ignoredZero += 1; continue; }
    if (ending && beginning) compared += 1;
    const reason = !ending ? "saldo final anterior ausente" : !beginning ? "saldo inicial atual ausente" : String(ending.natureza_conta ?? "") !== String(beginning.natureza_conta ?? "") ? "natureza diferente" : Number(ending.valor) !== Number(beginning.valor) ? "valor diferente" : null;
    if (!reason) continue;
    differences += 1;
    if (issues.length < 50) issues.push(`${String(ending?.conta_contabil ?? beginning?.conta_contabil ?? "Conta")}: ${reason}`);
  }
  return { compared, ignoredZero, differences, issues };
}
function compareMovement(rows: ApiRow[]) {
  const values = new Map<string, { account: string; beginning: number; change: number; ending: number; types: Set<string> }>();
  for (const row of rows) {
    const key = balanceKey(row);
    const current = values.get(key) ?? { account: String(row.conta_contabil ?? "Conta"), beginning: 0, change: 0, ending: 0, types: new Set<string>() };
    const value = Number(row.valor);
    if (!Number.isFinite(value)) continue;
    if (row.tipo_valor === "beginning_balance") current.beginning += value;
    else if (row.tipo_valor === "period_change") current.change += value;
    else if (row.tipo_valor === "ending_balance") current.ending += value;
    if (row.tipo_valor) current.types.add(row.tipo_valor);
    values.set(key, current);
  }
  let compared = 0;
  let differences = 0;
  const issues: string[] = [];
  for (const value of values.values()) {
    if (value.types.size === 0) continue;
    compared += 1;
    const difference = value.beginning + value.change - value.ending;
    if (Math.abs(difference) < 0.005) continue;
    differences += 1;
    if (issues.length < 50) issues.push(`${value.account}: SI ${value.beginning.toFixed(2)} + MOV ${value.change.toFixed(2)} ≠ SF ${value.ending.toFixed(2)}`);
  }
  return { compared, differences, issues };
}
function balanceKey(row: ApiRow) {
  return JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => !["exercicio", "mes_referencia", "data_referencia", "entrada_msc", "valor", "natureza_conta", "tipo_valor"].includes(key)).sort(([a], [b]) => a.localeCompare(b))));
}
function setsEqual(left: Set<string>, right: Set<string>) { return left.size === right.size && [...left].every((item) => right.has(item)); }
function unique(values: string[]) { return [...new Set(values)]; }
function digits(value: unknown) { return String(value ?? "").replace(/\.0$/, "").replace(/\D/g, ""); }
function normalize(value?: string) { return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function emptyRules(): MscApiRuleResult[] { return ["D1_00018", "D1_00020", "D1_00022", "D1_00023", "D1_00024", "D1_00027", "D1_00028"].map((ruleCode) => ({ ruleCode: ruleCode as MscApiRuleResult["ruleCode"], passed: false, details: "Nenhuma MSC enviada", issues: [] })); }
