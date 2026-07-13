import type { ParsedCsv } from "@/lib/csv";
import fiscalFormulaPackage from "@/data/fiscal-formulas-2026.json";

export type FiscalValidationIssue = {
  ruleCode: string;
  severity: "erro" | "aviso";
  sheetName?: string;
  rowNumber?: number;
  column?: string;
  message: string;
};

export type FiscalValidationResult = {
  issues: FiscalValidationIssue[];
  errors: number;
  warnings: number;
  checkedRows: number;
  detectedReport: "DCA" | "RREO" | "RGF" | "Indefinido";
};

type FiscalFormulaRule = {
  report: "DCA" | "RREO" | "RGF";
  sourceFile: string;
  sheetName: string;
  address: string;
  formula: string;
};

const REQUIRED_HINTS = [
  "anexo",
  "demonstrativo",
  "ente",
  "exercicio",
  "periodo",
  "bimestre",
  "quadrimestre",
  "semestre",
  "linha",
  "coluna",
  "conta",
  "valor",
];

const NUMERIC_HINTS = [
  "valor",
  "saldo",
  "total",
  "receita",
  "despesa",
  "resultado",
  "limite",
  "divida",
  "deducao",
  "inscricao",
  "cancelamento",
  "pagamento",
  "restos",
];

const PERCENT_HINTS = ["percentual", "porcentagem", "%", "percent"];

export function validateFiscalFile(csv: ParsedCsv, fileName = ""): FiscalValidationResult {
  const issues: FiscalValidationIssue[] = [];
  const detectedReport = detectReport(csv, fileName);

  if (csv.headers.length === 0) {
    issues.push({
      ruleCode: "SICONFI-2026-EST-001",
      severity: "erro",
      message: "O arquivo Fiscal nao possui cabecalho ou dados reconheciveis.",
    });
  }

  if (csv.rows.length === 0) {
    issues.push({
      ruleCode: "SICONFI-2026-EST-001",
      severity: "erro",
      message: "O arquivo Fiscal nao possui linhas de dados para validar.",
    });
  }

  for (const duplicate of findDuplicateHeaders(csv.headers)) {
    issues.push({
      ruleCode: "SICONFI-2026-EST-001",
      severity: "erro",
      column: duplicate,
      message: `Cabecalho duplicado: "${duplicate}".`,
    });
  }

  for (const { sheetName, columns } of groupSheetColumns(csv)) {
    const sheetRows = csv.rows.filter((row) => getSheetName(row) === sheetName && isValidationRow(row));
    if (sheetRows.length === 0) continue;

    const emptyColumns = columns.filter((header) =>
      sheetRows.every((row) => String(row[header] ?? "").trim() === ""),
    );

    for (const column of emptyColumns) {
      issues.push({
        ruleCode: "SICONFI-2026-PRE-001",
        severity: "aviso",
        sheetName,
        column,
        message: `Coluna sem preenchimento no arquivo Fiscal: "${column}".`,
      });
    }
  }

  const seenKeys = new Map<string, { rowNumber: number; sheetName: string }>();

  for (const [index, row] of csv.rows.entries()) {
    const rowNumber = Number(row.__rowNumber) || index + 2;
    const sheetName = getSheetName(row);
    if (isHeaderRow(rowNumber, sheetName)) continue;

    const rowHeaders = getSheetHeaders(row, csv.headers);
    const requiredColumns = rowHeaders.filter((header) => hasHint(header, REQUIRED_HINTS));
    const numericColumns = rowHeaders.filter((header) => hasHint(header, NUMERIC_HINTS));
    const percentColumns = rowHeaders.filter((header) => hasHint(header, PERCENT_HINTS));
    const keyColumns = rowHeaders.filter((header) => hasHint(header, ["anexo", "linha", "coluna", "conta"]));

    for (const column of requiredColumns) {
      if (isIgnoredCellByColumn(rowNumber, column, rowHeaders, sheetName)) continue;

      if (String(row[column] ?? "").trim() === "") {
        issues.push({
          ruleCode: "SICONFI-2026-PRE-001",
          severity: "erro",
          sheetName,
          rowNumber,
          column,
          message: `Campo obrigatorio vazio em "${column}".`,
        });
      }
    }

    for (const column of numericColumns) {
      const value = String(row[column] ?? "").trim();
      if (isIgnoredCellByColumn(rowNumber, column, rowHeaders, sheetName)) continue;
      if (shouldIgnoreLeadingZero(rowNumber, column, rowHeaders, value)) continue;

      if (value && parseBrazilianNumber(value) === null) {
        issues.push({
          ruleCode: "SICONFI-2026-NUM-001",
          severity: "erro",
          sheetName,
          rowNumber,
          column,
          message: `Valor numerico invalido em "${column}": ${value}.`,
        });
      }
    }

    for (const column of percentColumns) {
      const value = String(row[column] ?? "").trim();
      if (isIgnoredCellByColumn(rowNumber, column, rowHeaders, sheetName)) continue;
      if (shouldIgnoreLeadingZero(rowNumber, column, rowHeaders, value)) continue;

      const parsed = value ? parseBrazilianNumber(value.replace("%", "")) : null;

      if (value && parsed === null) {
        issues.push({
          ruleCode: "SICONFI-2026-PCT-001",
          severity: "erro",
          sheetName,
          rowNumber,
          column,
          message: `Percentual invalido em "${column}": ${value}.`,
        });
      } else if (parsed !== null && Math.abs(parsed) > 100) {
        issues.push({
          ruleCode: "SICONFI-2026-PCT-001",
          severity: "aviso",
          sheetName,
          rowNumber,
          column,
          message: `Percentual acima de 100 em "${column}": ${value}.`,
        });
      }
    }

    if (keyColumns.length >= 2) {
      const keyValues = keyColumns.map((column) => normalizeText(row[column] ?? ""));
      const key = `${sheetName}|${keyValues.join("|")}`;

      if (keyValues.some(Boolean)) {
        const previous = seenKeys.get(key);

        if (previous) {
          issues.push({
            ruleCode: "SICONFI-2026-CRZ-001",
            severity: "aviso",
            sheetName,
            rowNumber,
            message: `Possivel chave Fiscal duplicada; primeira ocorrencia na aba ${previous.sheetName}, linha ${previous.rowNumber}.`,
          });
        } else {
          seenKeys.set(key, { rowNumber, sheetName });
        }
      }
    }
  }

  issues.push(...validateFormulaConsistency(csv, detectedReport));

  return {
    issues,
    errors: issues.filter((issue) => issue.severity === "erro").length,
    warnings: issues.filter((issue) => issue.severity === "aviso").length,
    checkedRows: csv.rows.length,
    detectedReport,
  };
}

export function validateMatrixFormulaRange(csv: ParsedCsv): FiscalValidationResult {
  const issues: FiscalValidationIssue[] = [];
  const sheetName = "MATRIZ";
  const cells = new Map<string, { value: number | null; rawValue: string; rowNumber: number; sheetName: string }>();

  for (const [index, row] of csv.rows.entries()) {
    const rowNumber = Number(row.__rowNumber) || index + 2;
    const values = getRowCellValues(row, csv.headers, rowNumber);

    for (const [address, rawValue] of Object.entries(values)) {
      cells.set(cellKey(sheetName, address), {
        value: parseBrazilianNumber(rawValue),
        rawValue,
        rowNumber,
        sheetName,
      });
    }
  }

  const formulaRules = getTemplateFormulaRules("RREO").filter(
    (rule) => /^rreo-anexo\s+0?1\b/i.test(rule.sheetName) && isAddressInRange(rule.address, "B21", "H98"),
  );

  for (const rule of formulaRules) {
    const cell = cells.get(cellKey(sheetName, rule.address));
    if (!cell) continue;

    const evaluated = evaluateArithmeticFormula(rule.formula, sheetName, cells, true);
    if (!evaluated.supported) continue;

    if (cell.value === null) {
      issues.push({
        ruleCode: "SICONFI-2026-MTZ-001",
        severity: "erro",
        sheetName,
        rowNumber: rowNumberFromAddress(rule.address),
        column: rule.address,
        message: `Matriz com valor nao numerico em ${rule.address}: ${cell.rawValue || "(vazio)"}.`,
      });
      continue;
    }

    if (Math.abs(cell.value - evaluated.value) > 0.01) {
      issues.push({
        ruleCode: "SICONFI-2026-MTZ-001",
        severity: "erro",
        sheetName,
        rowNumber: rowNumberFromAddress(rule.address),
        column: rule.address,
        message: `Formula da Matriz inconsistente em ${rule.address}: informado ${formatNumber(cell.value)}, esperado ${formatNumber(evaluated.value)}. Formula: ${truncateFormula(rule.formula)}.`,
      });
    }
  }

  return {
    issues,
    errors: issues.filter((issue) => issue.severity === "erro").length,
    warnings: issues.filter((issue) => issue.severity === "aviso").length,
    checkedRows: csv.rows.length,
    detectedReport: "RREO",
  };
}

function validateFormulaConsistency(
  csv: ParsedCsv,
  detectedReport: FiscalValidationResult["detectedReport"],
): FiscalValidationIssue[] {
  const issues: FiscalValidationIssue[] = [];
  const cells = new Map<string, { value: number | null; rawValue: string; rowNumber: number; sheetName: string }>();
  const formulas: Array<{
    address: string;
    formula: string;
    rowNumber: number;
    sheetName: string;
    value: number | null;
    rawValue: string;
    sourceFile?: string;
  }> = [];
  const importedFormulaKeys = new Set<string>();
  const sheetNames = new Set<string>();

  for (const [index, row] of csv.rows.entries()) {
    const rowNumber = Number(row.__rowNumber) || index + 2;
    const sheetName = getSheetName(row);
    const values = parseJsonRecord(row.__cellValues);
    const rowFormulas = parseJsonRecord(row.__cellFormulas);
    sheetNames.add(sheetName);

    for (const [address, rawValue] of Object.entries(values)) {
      cells.set(cellKey(sheetName, address), {
        value: parseBrazilianNumber(rawValue),
        rawValue,
        rowNumber,
        sheetName,
      });
    }

    for (const [address, formula] of Object.entries(rowFormulas)) {
      if (isHeaderCell(address, sheetName)) continue;

      importedFormulaKeys.add(cellKey(sheetName, address));
      formulas.push({
        address,
        formula,
        rowNumber,
        sheetName,
        value: parseBrazilianNumber(values[address] ?? ""),
        rawValue: values[address] ?? "",
      });
    }
  }

  for (const rule of getTemplateFormulaRules(detectedReport)) {
    if (!sheetNames.has(rule.sheetName)) continue;
    if (importedFormulaKeys.has(cellKey(rule.sheetName, rule.address))) continue;
    if (isHeaderCell(rule.address, rule.sheetName)) continue;

    const cell = cells.get(cellKey(rule.sheetName, rule.address));

    formulas.push({
      address: rule.address,
      formula: rule.formula,
      rowNumber: rowNumberFromAddress(rule.address),
      sheetName: rule.sheetName,
      value: cell?.value ?? null,
      rawValue: cell?.rawValue ?? "",
      sourceFile: rule.sourceFile,
    });
  }

  for (const item of formulas) {
    const evaluated = evaluateArithmeticFormula(item.formula, item.sheetName, cells);
    if (!evaluated.supported) {
      issues.push({
        ruleCode: "SICONFI-2026-CRZ-001",
        severity: "aviso",
        sheetName: item.sheetName,
        rowNumber: item.rowNumber,
        column: item.address,
        message: `Formula nao avaliada automaticamente em ${item.address}: ${truncateFormula(item.formula)}.`,
      });
      continue;
    }

    if (item.value === null) {
      issues.push({
        ruleCode: "SICONFI-2026-NUM-001",
        severity: "erro",
        sheetName: item.sheetName,
        rowNumber: item.rowNumber,
        column: item.address,
        message: `Celula com formula sem valor numerico em ${item.address}: ${item.rawValue || "(vazio)"}.`,
      });
      continue;
    }

    if (Math.abs(item.value - evaluated.value) > 0.01) {
      issues.push({
        ruleCode: "SICONFI-2026-CRZ-001",
        severity: "erro",
        sheetName: item.sheetName,
        rowNumber: item.rowNumber,
        column: item.address,
        message: `Formula inconsistente em ${item.address}: informado ${formatNumber(item.value)}, esperado ${formatNumber(evaluated.value)}. Formula: ${truncateFormula(item.formula)}.`,
      });
    }
  }

  return issues;
}

function getTemplateFormulaRules(detectedReport: FiscalValidationResult["detectedReport"]) {
  if (detectedReport === "Indefinido") return [];

  const packageRules = (fiscalFormulaPackage as { rules: FiscalFormulaRule[] }).rules;
  return packageRules.filter((rule) => rule.report === detectedReport);
}

function rowNumberFromAddress(address: string) {
  return Number(address.match(/\d+/)?.[0] ?? 0) || 0;
}

function getRowCellValues(row: Record<string, string>, headers: string[], rowNumber: number) {
  const preservedValues = parseJsonRecord(row.__cellValues);
  if (Object.keys(preservedValues).length > 0) return preservedValues;

  return Object.fromEntries(
    headers.map((header, index) => [
      columnIndexToLetters(index) + rowNumber,
      String(row[header] ?? "").trim(),
    ]),
  );
}

function isAddressInRange(address: string, start: string, end: string) {
  const position = parseCellAddress(address);
  const startPosition = parseCellAddress(start);
  const endPosition = parseCellAddress(end);

  if (!position || !startPosition || !endPosition) return false;

  return (
    position.rowNumber >= startPosition.rowNumber &&
    position.rowNumber <= endPosition.rowNumber &&
    position.columnIndex >= startPosition.columnIndex &&
    position.columnIndex <= endPosition.columnIndex
  );
}

function shouldIgnoreLeadingZero(rowNumber: number, column: string, headers: string[], value: string) {
  const columnIndex = headers.indexOf(column);
  if (columnIndex < 1 || rowNumber < 1 || rowNumber > 16) return false;

  return parseBrazilianNumber(value) === 0;
}

function isValidationRow(row: Record<string, string>) {
  return !isHeaderRow(Number(row.__rowNumber) || 0, getSheetName(row));
}

function isHeaderRow(rowNumber: number, sheetName = "") {
  if (rowNumber >= 1 && rowNumber <= 16) return true;
  if (/^rreo-anexo\s+0?1\b/i.test(sheetName) && rowNumber === 20) return true;
  return isAnexoI(sheetName) && rowNumber >= 17 && rowNumber <= 19;
}

function isHeaderCell(address: string, sheetName = "") {
  const position = parseCellAddress(address);
  return Boolean(
    position &&
      (isHeaderRow(position.rowNumber, sheetName) ||
        isIgnoredRreoAnexo01TailBlock(position.rowNumber, position.columnIndex, sheetName)),
  );
}

function isAnexoI(sheetName: string) {
  return /\banexo\s+i\b/i.test(sheetName) || /^rreo-anexo\s+0?1\b/i.test(sheetName);
}

function isIgnoredCellByColumn(rowNumber: number, column: string, headers: string[], sheetName: string) {
  return isIgnoredRreoAnexo01TailBlock(rowNumber, headers.indexOf(column), sheetName);
}

function isIgnoredRreoAnexo01TailBlock(rowNumber: number, columnIndex: number, sheetName: string) {
  return /^rreo-anexo\s+0?1\b/i.test(sheetName) && rowNumber >= 1 && rowNumber <= 103 && columnIndex >= 8;
}

function parseCellAddress(address: string) {
  const match = /^([A-Z]{1,3})(\d+)$/i.exec(address);
  if (!match) return null;

  return {
    columnIndex: columnLettersToIndex(match[1]),
    rowNumber: Number(match[2]),
  };
}

function columnLettersToIndex(column: string) {
  return [...column.toUpperCase()].reduce(
    (total, char) => total * 26 + char.charCodeAt(0) - 64,
    0,
  ) - 1;
}

function columnIndexToLetters(index: number) {
  let value = index + 1;
  let letters = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }

  return letters;
}

function evaluateArithmeticFormula(
  formula: string,
  currentSheetName: string,
  cells: Map<string, { value: number | null }>,
  forceCurrentSheet = false,
) {
  const normalizedFormula = formula.trim().replace(/^=/, "");
  const withoutReferences = normalizedFormula
    .replace(/(?:'([^']+)'|([A-Za-z0-9 _.-]+))?!?\$?[A-Z]{1,3}\$?\d+/g, "")
    .replace(/[+\-\s]/g, "");

  if (withoutReferences) return { supported: false, value: 0 };

  let total = 0;
  const references = normalizedFormula.matchAll(/([+\-]?)(?:(?:'([^']+)'|([A-Za-z0-9 _.-]+))!)?\$?([A-Z]{1,3})\$?(\d+)/g);

  for (const match of references) {
    const sign = match[1] === "-" ? -1 : 1;
    const sheetName = forceCurrentSheet ? currentSheetName : (match[2] || match[3] || currentSheetName).trim();
    const address = `${match[4]}${match[5]}`;
    const cell = cells.get(cellKey(sheetName, address));

    if (!cell || cell.value === null) return { supported: false, value: 0 };
    total += sign * cell.value;
  }

  return { supported: true, value: total };
}

function cellKey(sheetName: string, address: string) {
  return `${sheetName.toLowerCase()}!${address.toUpperCase()}`;
}

function parseJsonRecord(value?: string) {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).map(([key, entry]) => [key, String(entry ?? "")]))
      : {};
  } catch {
    return {};
  }
}

function truncateFormula(formula: string) {
  return formula.length > 120 ? `${formula.slice(0, 117)}...` : formula;
}

function formatNumber(value: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function groupSheetColumns(csv: ParsedCsv) {
  if (csv.rows.length === 0) return [{ sheetName: "Arquivo", columns: csv.headers }];

  const groups = new Map<string, Set<string>>();

  for (const row of csv.rows) {
    const sheetName = getSheetName(row);
    const columns = groups.get(sheetName) ?? new Set<string>();
    for (const header of getSheetHeaders(row, csv.headers)) columns.add(header);
    groups.set(sheetName, columns);
  }

  return [...groups.entries()].map(([sheetName, columns]) => ({
    sheetName,
    columns: [...columns],
  }));
}

function getSheetName(row: Record<string, string>) {
  return row.__sheetName || "Arquivo";
}

function getSheetHeaders(row: Record<string, string>, fallback: string[]) {
  if (!row.__sheetHeaders) return fallback;

  try {
    const parsed = JSON.parse(row.__sheetHeaders);
    return Array.isArray(parsed) ? parsed.map(String) : fallback;
  } catch {
    return fallback;
  }
}

function findDuplicateHeaders(headers: string[]) {
  const counts = new Map<string, number>();
  const duplicates = new Set<string>();

  for (const header of headers) {
    const normalized = normalizeText(header);
    const current = counts.get(normalized) ?? 0;
    counts.set(normalized, current + 1);
    if (current > 0) duplicates.add(header);
  }

  return [...duplicates];
}

function detectReport(csv: ParsedCsv, fileName: string) {
  const sampleRows = csv.rows.slice(0, 20).map((row) => Object.values(row).join(" ")).join(" ");
  const haystack = normalizeText(`${fileName} ${csv.headers.join(" ")} ${sampleRows}`);

  if (haystack.includes("dca") || haystack.includes("contas anuais")) return "DCA";
  if (haystack.includes("rgf") || haystack.includes("gestao fiscal")) return "RGF";
  if (haystack.includes("rreo") || haystack.includes("execucao orcamentaria")) return "RREO";

  return "Indefinido";
}

function hasHint(value: string, hints: string[]) {
  const normalized = normalizeText(value);
  return hints.some((hint) => normalized.includes(normalizeText(hint)));
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function parseBrazilianNumber(value: string) {
  const cleaned = value
    .replace(/\s/g, "")
    .replace(/^R\$/i, "")
    .replace(/[()]/g, "")
    .replace(/\u00a0/g, "");

  if (!cleaned) return null;

  const decimalNormalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(decimalNormalized);
  return Number.isFinite(parsed) ? parsed : null;
}
