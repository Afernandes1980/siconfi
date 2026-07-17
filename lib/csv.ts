export type CsvRow = Record<string, string>;

export type ParsedCsv = {
  headers: string[];
  rows: CsvRow[];
  delimiter: string;
  metadataRows?: string[][];
};

type ParseCsvOptions = {
  delimiter?: string;
  hasHeader?: boolean;
  headerRowIndex?: number;
  dataStartRowIndex?: number;
};

const CANDIDATE_DELIMITERS = [";", ",", "\t", "|"];

export function parseCsv(text: string, options: ParseCsvOptions | string = {}): ParsedCsv {
  const parseOptions = typeof options === "string" ? { delimiter: options } : options;
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const selectedDelimiter = parseOptions.delimiter || detectDelimiter(normalized);
  const records = parseRecords(normalized, selectedDelimiter).filter((record) =>
    record.some((value) => value.trim() !== ""),
  );

  if (records.length === 0) {
    return { headers: [], rows: [], delimiter: selectedDelimiter, metadataRows: [] };
  }

  const hasHeader = parseOptions.hasHeader ?? true;
  const maxColumns = Math.max(...records.map((record) => record.length));
  const headerRowIndex = hasHeader ? parseOptions.headerRowIndex ?? 0 : -1;
  const dataStartRowIndex = parseOptions.dataStartRowIndex ?? (hasHeader ? headerRowIndex + 1 : 0);
  const headers = hasHeader
    ? (records[headerRowIndex] ?? []).map((header, index) => {
        const normalizedHeader = header.trim();
        return normalizedHeader || `coluna_${index + 1}`;
      })
    : Array.from({ length: maxColumns }, (_, index) => (maxColumns === 1 ? "Linha bruta" : `Coluna ${index + 1}`));
  const dataRecords = records.slice(dataStartRowIndex);

  const rows = dataRecords.map((record, recordIndex) =>
    headers.reduce<CsvRow>((row, header, index) => {
      row[header] = record[index]?.trim() ?? "";
      row.__rowNumber = String(dataStartRowIndex + recordIndex + 1);
      return row;
    }, {}),
  );

  return {
    headers,
    rows,
    delimiter: selectedDelimiter,
    metadataRows: records.slice(0, dataStartRowIndex),
  };
}

function detectDelimiter(text: string) {
  const firstLine = text.split("\n").find((line) => line.trim()) ?? "";

  return CANDIDATE_DELIMITERS.reduce(
    (best, delimiter) => {
      const count = countDelimiter(firstLine, delimiter);
      return count > best.count ? { delimiter, count } : best;
    },
    { delimiter: ";", count: 0 },
  ).delimiter;
}

function countDelimiter(line: string, delimiter: string) {
  let count = 0;
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      index += 1;
      continue;
    }

    if (char === '"') quoted = !quoted;
    if (!quoted && char === delimiter) count += 1;
  }

  return count;
}

function parseRecords(text: string, delimiter: string) {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && char === delimiter) {
      record.push(field);
      field = "";
      continue;
    }

    if (!quoted && char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      continue;
    }

    field += char;
  }

  record.push(field);
  records.push(record);

  return records;
}

export function toCsv(rows: CsvRow[], headers: string[], delimiter = ";") {
  const lines = [
    headers.map((header) => escapeCsvValue(header, delimiter)).join(delimiter),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header] ?? "", delimiter)).join(delimiter)),
  ];

  return lines.join("\n");
}

function escapeCsvValue(value: string, delimiter: string) {
  const shouldQuote = value.includes(delimiter) || value.includes('"') || value.includes("\n");
  const escaped = value.replace(/"/g, '""');
  return shouldQuote ? `"${escaped}"` : escaped;
}
