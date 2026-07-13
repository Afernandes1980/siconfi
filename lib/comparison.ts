import type { CsvRow } from "@/lib/csv";

export type ComparisonRuleKind = "equals" | "equalsIgnoreCase" | "contains" | "number" | "date";

export type FieldMapping = {
  id: string;
  sourceColumn: string;
  targetColumn: string;
  rule: ComparisonRuleKind;
  tolerance?: number;
};

export type ComparisonConfig = {
  sourceKey: string;
  targetKey: string;
  mappings: FieldMapping[];
};

export type ComparisonIssue = {
  mappingId: string;
  sourceColumn: string;
  targetColumn: string;
  rule: ComparisonRuleKind;
  expected: string;
  received: string;
  message: string;
};

export type ComparisonResultRow = {
  key: string;
  status: "ok" | "different" | "missing-target" | "missing-source";
  sourceRow?: CsvRow;
  targetRow?: CsvRow;
  issues: ComparisonIssue[];
};

export function compareCsvRows(sourceRows: CsvRow[], targetRows: CsvRow[], config: ComparisonConfig) {
  const targetIndex = new Map<string, CsvRow[]>();
  const sourceKeys = new Set<string>();

  for (const targetRow of targetRows) {
    const key = normalizeKey(targetRow[config.targetKey]);
    if (!targetIndex.has(key)) targetIndex.set(key, []);
    targetIndex.get(key)?.push(targetRow);
  }

  const results: ComparisonResultRow[] = sourceRows.map((sourceRow) => {
    const key = normalizeKey(sourceRow[config.sourceKey]);
    sourceKeys.add(key);
    const targetRow = targetIndex.get(key)?.[0];

    if (!targetRow) {
      return {
        key,
        status: "missing-target",
        sourceRow,
        issues: [],
      };
    }

    const issues = config.mappings
      .map((mapping) => compareMapping(sourceRow, targetRow, mapping))
      .filter((issue): issue is ComparisonIssue => Boolean(issue));

    return {
      key,
      status: issues.length > 0 ? "different" : "ok",
      sourceRow,
      targetRow,
      issues,
    };
  });

  for (const targetRow of targetRows) {
    const key = normalizeKey(targetRow[config.targetKey]);
    if (!sourceKeys.has(key)) {
      results.push({
        key,
        status: "missing-source",
        targetRow,
        issues: [],
      });
    }
  }

  return results;
}

export function summarizeResults(results: ComparisonResultRow[]) {
  return {
    ok: results.filter((result) => result.status === "ok").length,
    different: results.filter((result) => result.status === "different").length,
    missingTarget: results.filter((result) => result.status === "missing-target").length,
    missingSource: results.filter((result) => result.status === "missing-source").length,
    total: results.length,
  };
}

export function resultRowsToCsvRows(results: ComparisonResultRow[]) {
  return results.flatMap<CsvRow>((result) => {
    if (result.issues.length === 0) {
      return [
        {
          chave: result.key,
          status: statusLabel(result.status),
          coluna_arquivo_a: "",
          coluna_arquivo_b: "",
          regra: "",
          valor_arquivo_a: "",
          valor_arquivo_b: "",
          detalhe: "",
        },
      ];
    }

    return result.issues.map((issue) => ({
      chave: result.key,
      status: statusLabel(result.status),
      coluna_arquivo_a: issue.sourceColumn,
      coluna_arquivo_b: issue.targetColumn,
      regra: ruleLabel(issue.rule),
      valor_arquivo_a: issue.expected,
      valor_arquivo_b: issue.received,
      detalhe: issue.message,
    }));
  });
}

export function statusLabel(status: ComparisonResultRow["status"]) {
  const labels = {
    ok: "Conferido",
    different: "Divergente",
    "missing-target": "Nao encontrado no arquivo B",
    "missing-source": "Nao encontrado no arquivo A",
  };

  return labels[status];
}

export function ruleLabel(rule: ComparisonRuleKind) {
  const labels = {
    equals: "Igual",
    equalsIgnoreCase: "Igual ignorando maiusculas",
    contains: "Contem",
    number: "Numero com tolerancia",
    date: "Mesma data",
  };

  return labels[rule];
}

function compareMapping(sourceRow: CsvRow, targetRow: CsvRow, mapping: FieldMapping): ComparisonIssue | null {
  const expected = sourceRow[mapping.sourceColumn] ?? "";
  const received = targetRow[mapping.targetColumn] ?? "";
  const passed = applyRule(expected, received, mapping.rule, mapping.tolerance ?? 0);

  if (passed) return null;

  return {
    mappingId: mapping.id,
    sourceColumn: mapping.sourceColumn,
    targetColumn: mapping.targetColumn,
    rule: mapping.rule,
    expected,
    received,
    message: buildIssueMessage(expected, received, mapping),
  };
}

function applyRule(expected: string, received: string, rule: ComparisonRuleKind, tolerance: number) {
  const left = expected.trim();
  const right = received.trim();

  if (rule === "equals") return left === right;
  if (rule === "equalsIgnoreCase") return normalizeText(left) === normalizeText(right);
  if (rule === "contains") return normalizeText(right).includes(normalizeText(left));

  if (rule === "number") {
    const leftNumber = parseBrazilianNumber(left);
    const rightNumber = parseBrazilianNumber(right);
    if (leftNumber === null || rightNumber === null) return false;
    return Math.abs(leftNumber - rightNumber) <= tolerance;
  }

  if (rule === "date") {
    return normalizeDate(left) !== null && normalizeDate(left) === normalizeDate(right);
  }

  return false;
}

function buildIssueMessage(expected: string, received: string, mapping: FieldMapping) {
  if (mapping.rule === "number") {
    return `Diferenca numerica maior que ${mapping.tolerance ?? 0}.`;
  }

  if (mapping.rule === "date") {
    return "Datas nao equivalentes.";
  }

  return `Esperado "${expected}", encontrado "${received}".`;
}

function normalizeKey(value?: string) {
  return (value ?? "").trim();
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseBrazilianNumber(value: string) {
  const cleaned = value.replace(/\s/g, "");
  const decimalNormalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(decimalNormalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value: string) {
  const trimmed = value.trim();
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (brazilian) return `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  return null;
}
