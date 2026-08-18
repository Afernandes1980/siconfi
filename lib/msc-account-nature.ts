import { listPcaspAccounts, type PcaspAccount } from "@/lib/rules-db";
import { fetchSiconfi } from "@/lib/siconfi-api";
import type { RreoDelivery } from "@/lib/rreo-timeliness";

type MscAccountRow = { conta_contabil?: string | number | null; valor?: string | number | null; natureza_conta?: string | null };
type MscResponse = { items?: MscAccountRow[]; hasMore?: boolean; limit?: number };

export type MscAccountNatureEvaluation = {
  ruleCode: "D1_00021" | "D1_00025" | "D1_00026";
  exercise: number;
  month: number | null;
  deliveryDate: string | null;
  checked: number;
  correct: number;
  inverted: number;
  withoutNature: number;
  points: 0 | 1;
  classification: "total" | "pending";
  accounts: Array<{ account: string; expectedNature: string; actualNature: string; status: "Correta" | "Invertida" | "Sem natureza"; occurrences: number }>;
};

export async function evaluateLatestMscAccountNatures(exercise: number, entityId: string, deliveries: RreoDelivery[]): Promise<MscAccountNatureEvaluation> {
  const latest = deliveries
    .filter((item) => item.periodicidade === "M" && normalizeText(item.entregavel).includes("msc agregada") && Number(item.periodo) >= 1 && Number(item.periodo) <= 12 && item.data_status)
    .sort((a, b) => String(b.data_status).localeCompare(String(a.data_status)))[0];
  if (!latest) return result("D1_00021", exercise, null, null, 0, 0, 0, 0, []);

  const pcaspIndex = buildPcaspIndex(await listPcaspAccounts());
  const accountRows = new Map<string, MscAccountNatureEvaluation["accounts"][number]>();
  let offset = 0;
  let checked = 0;
  let correct = 0;
  let inverted = 0;
  let withoutNature = 0;
  do {
    const query = new URLSearchParams({
      id_ente: entityId,
      an_referencia: String(exercise),
      me_referencia: String(latest.periodo),
      co_tipo_matriz: "MSCC",
      classe_conta: "1",
      id_tv: "ending_balance",
      limit: "5000",
      offset: String(offset),
    });
    const response = await fetchSiconfi("msc_patrimonial", query) as MscResponse;
    const items = response.items ?? [];
    for (const row of items) {
      if (Number(row.valor) === 0) continue;
      const actualNature = extractNature(row.natureza_conta);
      const account = String(row.conta_contabil ?? "");
      const pcaspAccount = findPcaspAccount(account, pcaspIndex);
      const expectedNature = pcaspAccount?.balanceNature || "Não encontrada no PCASP";
      if (!actualNature) {
        withoutNature += 1;
        addAccountRow(accountRows, { account, expectedNature, actualNature: "-", status: "Sem natureza", occurrences: 1 });
        continue;
      }
      checked += 1;
      if (pcaspAccount && acceptsNature(pcaspAccount.normalizedNature, actualNature)) {
        correct += 1;
        addAccountRow(accountRows, { account, expectedNature, actualNature, status: "Correta", occurrences: 1 });
      } else {
        inverted += 1;
        addAccountRow(accountRows, { account, expectedNature, actualNature, status: "Invertida", occurrences: 1 });
      }
    }
    if (!response.hasMore || items.length === 0) break;
    offset += response.limit ?? items.length;
  } while (true);

  const accounts = [...accountRows.values()].sort((a, b) => Number(a.status === "Correta") - Number(b.status === "Correta") || a.account.localeCompare(b.account));
  return result("D1_00021", exercise, Number(latest.periodo), latest.data_status ?? null, checked, correct, inverted, withoutNature, accounts);
}

export async function evaluateLatestMscLiabilityNatures(exercise: number, entityId: string, deliveries: RreoDelivery[]) {
  const latest = deliveries
    .filter((item) => item.periodicidade === "M" && normalizeText(item.entregavel).includes("msc agregada") && Number(item.periodo) >= 1 && Number(item.periodo) <= 12 && item.data_status)
    .sort((a, b) => String(b.data_status).localeCompare(String(a.data_status)))[0];
  if (!latest) return {
    d1_00025: result("D1_00025", exercise, null, null, 0, 0, 0, 0, []),
    d1_00026: result("D1_00026", exercise, null, null, 0, 0, 0, 0, []),
  };
  const pcaspIndex = buildPcaspIndex(await listPcaspAccounts());
  const rows: MscAccountRow[] = [];
  let offset = 0;
  do {
    const query = new URLSearchParams({ id_ente: entityId, an_referencia: String(exercise), me_referencia: String(latest.periodo), co_tipo_matriz: "MSCC", classe_conta: "2", id_tv: "ending_balance", limit: "5000", offset: String(offset) });
    const response = await fetchSiconfi("msc_patrimonial", query) as MscResponse;
    const items = response.items ?? [];
    rows.push(...items);
    if (!response.hasMore || items.length === 0) break;
    offset += response.limit ?? items.length;
  } while (true);
  const deliveryDate = latest.data_status ?? null;
  return {
    d1_00025: evaluateRows("D1_00025", exercise, Number(latest.periodo), deliveryDate, rows.filter((row) => /^(21|22)/.test(normalizeAccountCode(String(row.conta_contabil ?? "")))), pcaspIndex),
    d1_00026: evaluateRows("D1_00026", exercise, Number(latest.periodo), deliveryDate, rows.filter((row) => /^23/.test(normalizeAccountCode(String(row.conta_contabil ?? "")))), pcaspIndex),
  };
}

function evaluateRows(ruleCode: "D1_00025" | "D1_00026", exercise: number, month: number, deliveryDate: string | null, rows: MscAccountRow[], pcaspIndex: Map<string, PcaspAccount>) {
  let checked = 0, correct = 0, inverted = 0, withoutNature = 0;
  const accountRows = new Map<string, MscAccountNatureEvaluation["accounts"][number]>();
  for (const row of rows) {
    if (Number(row.valor) === 0) continue;
    const account = String(row.conta_contabil ?? "");
    const pcaspAccount = findPcaspAccount(account, pcaspIndex);
    const expectedNature = pcaspAccount?.balanceNature || "Não encontrada no PCASP";
    const actualNature = extractNature(row.natureza_conta);
    if (!actualNature) { withoutNature += 1; addAccountRow(accountRows, { account, expectedNature, actualNature: "-", status: "Sem natureza", occurrences: 1 }); continue; }
    checked += 1;
    if (pcaspAccount && acceptsNature(pcaspAccount.normalizedNature, actualNature)) { correct += 1; addAccountRow(accountRows, { account, expectedNature, actualNature, status: "Correta", occurrences: 1 }); }
    else { inverted += 1; addAccountRow(accountRows, { account, expectedNature, actualNature, status: "Invertida", occurrences: 1 }); }
  }
  const accounts = [...accountRows.values()].sort((a, b) => Number(a.status === "Correta") - Number(b.status === "Correta") || a.account.localeCompare(b.account));
  return result(ruleCode, exercise, month, deliveryDate, checked, correct, inverted, withoutNature, accounts);
}

function result(ruleCode: MscAccountNatureEvaluation["ruleCode"], exercise: number, month: number | null, deliveryDate: string | null, checked: number, correct: number, inverted: number, withoutNature: number, accounts: MscAccountNatureEvaluation["accounts"]): MscAccountNatureEvaluation {
  const points = month !== null && checked > 0 && inverted === 0 && withoutNature === 0 ? 1 : 0;
  return { ruleCode, exercise, month, deliveryDate, checked, correct, inverted, withoutNature, points, classification: points ? "total" : "pending", accounts };
}

function addAccountRow(rows: Map<string, MscAccountNatureEvaluation["accounts"][number]>, row: MscAccountNatureEvaluation["accounts"][number]) {
  const key = `${row.account}\u0000${row.expectedNature}\u0000${row.actualNature}\u0000${row.status}`;
  const current = rows.get(key);
  rows.set(key, { ...row, occurrences: (current?.occurrences ?? 0) + 1 });
}

function buildPcaspIndex(accounts: PcaspAccount[]) {
  return new Map(accounts.map((account) => [normalizeAccountCode(account.account), account]));
}

function findPcaspAccount(account: string, index: Map<string, PcaspAccount>) {
  const normalized = normalizeAccountCode(account);
  const exact = index.get(normalized);
  if (exact) return exact;
  for (let length = normalized.length - 1; length > 0; length -= 1) {
    const match = index.get(normalized.slice(0, length).padEnd(normalized.length, "0"));
    if (match) return match;
  }
  return null;
}

function acceptsNature(expected: PcaspAccount["normalizedNature"], actual: string) {
  return expected === "D/C" ? actual === "D" || actual === "C" : expected === actual;
}

function normalizeAccountCode(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? digits.padStart(9, "0") : "";
}

function extractNature(value?: string | null) {
  const normalized = normalizeText(value);
  if (normalized === "d" || normalized.startsWith("d ") || normalized.includes("deved")) return "D";
  if (normalized === "c" || normalized.startsWith("c ") || normalized.includes("cred")) return "C";
  return "";
}

function normalizeText(value?: string | null) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
