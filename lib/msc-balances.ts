import type { ParsedCsv } from "@/lib/csv";

export type MscBalanceRow = {
  comparisonKey: string;
  keyValues: string[];
  valueType: "beginning_balance" | "ending_balance";
  value: number | null;
  rawValue: string;
  nature: string;
  rowNumber: number;
};

export type MscBalancePayload = {
  competenceKey: string;
  competenceLabel: string;
  rows: MscBalanceRow[];
};

export function extractMscBalances(csv: ParsedCsv): MscBalancePayload {
  const competenceLabel = String(csv.metadataRows?.[0]?.[1] ?? "").trim();
  const competenceKey = normalizeCompetence(competenceLabel);
  const valueIndex = csv.headers.length - 3;
  const typeIndex = csv.headers.length - 2;
  const natureIndex = csv.headers.length - 1;

  if (!competenceKey || valueIndex < 1) {
    return { competenceKey, competenceLabel, rows: [] };
  }

  const valueHeader = csv.headers[valueIndex];
  const typeHeader = csv.headers[typeIndex];
  const natureHeader = csv.headers[natureIndex];
  const keyHeaders = csv.headers.slice(0, valueIndex);
  const rows: MscBalanceRow[] = [];

  csv.rows.forEach((row, index) => {
    const normalizedType = normalizeValueType(row[typeHeader] ?? "");
    if (normalizedType !== "beginning_balance" && normalizedType !== "ending_balance") return;

    const keyValues = keyHeaders.map((header) => String(row[header] ?? "").trim());
    const rawValue = String(row[valueHeader] ?? "").trim();
    rows.push({
      comparisonKey: JSON.stringify(keyValues),
      keyValues,
      valueType: normalizedType,
      value: parseBalance(rawValue),
      rawValue,
      nature: String(row[natureHeader] ?? "").trim().toUpperCase(),
      rowNumber: Number(row.__rowNumber) || index + 3,
    });
  });

  return { competenceKey, competenceLabel, rows };
}

export function normalizeCompetence(value: string) {
  const trimmed = value.trim();
  const yearFirst = /\b(20\d{2})[-/.]?(0[1-9]|1[0-2])\b/.exec(trimmed);
  if (yearFirst) return `${yearFirst[1]}-${yearFirst[2]}`;

  const monthFirst = /\b(0?[1-9]|1[0-2])[-/.](20\d{2})\b/.exec(trimmed);
  if (monthFirst) return `${monthFirst[2]}-${monthFirst[1].padStart(2, "0")}`;

  return "";
}

function normalizeValueType(value: string) {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function parseBalance(value: string) {
  const cleaned = value.replace(/\s/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
