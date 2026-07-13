import * as XLSX from "xlsx";
import type { CsvRow, ParsedCsv } from "@/lib/csv";

export async function parseSpreadsheet(file: File): Promise<ParsedCsv> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const allHeaders = new Set<string>();
  const rows: CsvRow[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const parsedSheet = parseSheet(sheet, sheetName);
    for (const header of parsedSheet.headers) allHeaders.add(header);
    rows.push(...parsedSheet.rows);
  }

  if (allHeaders.size === 0 && rows.length === 0) {
    return { headers: [], rows: [], delimiter: "xls" };
  }

  return { headers: [...allHeaders], rows, delimiter: "xls" };
}

function parseSheet(sheet: XLSX.WorkSheet, sheetName: string) {
  const matrix = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date | null>>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  const firstDataRow = matrix.findIndex((row) => row.some((cell) => String(cell ?? "").trim() !== ""));
  if (firstDataRow < 0) {
    return { headers: [], rows: [] };
  }

  const headers = matrix[firstDataRow].map((cell, index) => {
    const value = String(cell ?? "").trim();
    return value || `coluna_${index + 1}`;
  });

  const rows = matrix.slice(firstDataRow + 1).flatMap((record, recordIndex) => {
    if (!record.some((cell) => String(cell ?? "").trim() !== "")) return [];

    const sourceRowIndex = firstDataRow + recordIndex + 1;
    const cellValues: Record<string, string> = {};
    const cellFormulas: Record<string, string> = {};
    const row = headers.reduce<CsvRow>((current, header, index) => {
      const address = XLSX.utils.encode_cell({ r: sourceRowIndex, c: index });
      const cell = sheet[address];
      const value = String(record[index] ?? "").trim();

      current[header] = value;

      if (value) cellValues[address] = String(cell?.v ?? value).trim();
      if (cell?.f) cellFormulas[address] = cell.f;

      return current;
    }, {});
    row.__rowNumber = String(firstDataRow + recordIndex + 2);
    row.__sheetName = sheetName;
    row.__sheetHeaders = JSON.stringify(headers);
    row.__cellValues = JSON.stringify(cellValues);
    row.__cellFormulas = JSON.stringify(cellFormulas);

    return [row];
  });

  return { headers, rows };
}
