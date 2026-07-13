import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import xlsx from "xlsx";
import { database, executeInBatches } from "./turso-client.mjs";

const inputFile = process.argv[2];

if (!inputFile || !existsSync(inputFile)) {
  console.error(`Arquivo nao encontrado: ${inputFile || "(nao informado)"}`);
  process.exit(1);
}

const sourceFile = path.basename(inputFile);
const workbook = xlsx.readFile(inputFile, { cellDates: false });

await database.exec(`
  CREATE TABLE IF NOT EXISTS msc_layout_sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_name TEXT NOT NULL,
    row_number INTEGER NOT NULL,
    row_json TEXT NOT NULL,
    source_file TEXT NOT NULL,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(sheet_name, row_number, source_file)
  );

  CREATE INDEX IF NOT EXISTS idx_msc_layout_sheets_sheet
    ON msc_layout_sheets (sheet_name);

  CREATE TABLE IF NOT EXISTS pcasp_extended_2026 (
    account TEXT PRIMARY KEY,
    class TEXT NOT NULL,
    group_code TEXT NOT NULL,
    subgroup TEXT NOT NULL,
    title_code TEXT NOT NULL,
    subtitle TEXT NOT NULL,
    item TEXT NOT NULL,
    subitem TEXT NOT NULL,
    title TEXT NOT NULL,
    function_description TEXT NOT NULL,
    balance_nature TEXT NOT NULL,
    normalized_nature TEXT NOT NULL,
    status TEXT NOT NULL,
    detailed_level TEXT NOT NULL,
    financial_surplus_indicator TEXT NOT NULL,
    complementary_info_id TEXT NOT NULL,
    complementary_info TEXT NOT NULL,
    source_file TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_pcasp_extended_2026_normalized_nature
    ON pcasp_extended_2026 (normalized_nature);
`);

const insertRawRowSql = `
  INSERT INTO msc_layout_sheets (sheet_name, row_number, row_json, source_file)
  VALUES (:sheetName, :rowNumber, :rowJson, :sourceFile)
  ON CONFLICT(sheet_name, row_number, source_file) DO UPDATE SET
    row_json = excluded.row_json,
    imported_at = CURRENT_TIMESTAMP
`;

const upsertPcaspSql = `
  INSERT INTO pcasp_extended_2026 (
    account,
    class,
    group_code,
    subgroup,
    title_code,
    subtitle,
    item,
    subitem,
    title,
    function_description,
    balance_nature,
    normalized_nature,
    status,
    detailed_level,
    financial_surplus_indicator,
    complementary_info_id,
    complementary_info,
    source_file
  )
  VALUES (
    :account,
    :classValue,
    :groupCode,
    :subgroup,
    :titleCode,
    :subtitle,
    :item,
    :subitem,
    :title,
    :functionDescription,
    :balanceNature,
    :normalizedNature,
    :status,
    :detailedLevel,
    :financialSurplusIndicator,
    :complementaryInfoId,
    :complementaryInfo,
    :sourceFile
  )
  ON CONFLICT(account) DO UPDATE SET
    class = excluded.class,
    group_code = excluded.group_code,
    subgroup = excluded.subgroup,
    title_code = excluded.title_code,
    subtitle = excluded.subtitle,
    item = excluded.item,
    subitem = excluded.subitem,
    title = excluded.title,
    function_description = excluded.function_description,
    balance_nature = excluded.balance_nature,
    normalized_nature = excluded.normalized_nature,
    status = excluded.status,
    detailed_level = excluded.detailed_level,
    financial_surplus_indicator = excluded.financial_surplus_indicator,
    complementary_info_id = excluded.complementary_info_id,
    complementary_info = excluded.complementary_info,
    source_file = excluded.source_file,
    updated_at = CURRENT_TIMESTAMP
`;

let rawRows = 0;
let pcaspRows = 0;
const rawStatements = [];
const pcaspStatements = [];

try {
  for (const sheetName of workbook.SheetNames) {
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });

    rows.forEach((row, index) => {
      rawStatements.push({
        sql: insertRawRowSql,
        args: {
          sheetName,
          rowNumber: index + 1,
          rowJson: JSON.stringify(row.map(clean)),
          sourceFile,
        },
      });
      rawRows += 1;
    });

    if (normalize(sheetName) === "pcaspestendido2026") {
      for (const row of rows.slice(4)) {
        const account = normalizeAccount(row[7]);
        if (!account) continue;

        const balanceNature = clean(row[10]);
        pcaspStatements.push({
          sql: upsertPcaspSql,
          args: {
            account,
            classValue: clean(row[0]),
            groupCode: clean(row[1]),
            subgroup: clean(row[2]),
            titleCode: clean(row[3]),
            subtitle: clean(row[4]),
            item: clean(row[5]),
            subitem: clean(row[6]),
            title: clean(row[8]),
            functionDescription: clean(row[9]),
            balanceNature,
            normalizedNature: normalizeBalanceNature(balanceNature),
            status: clean(row[11]),
            detailedLevel: clean(row[12]),
            financialSurplusIndicator: clean(row[13]),
            complementaryInfoId: clean(row[14]),
            complementaryInfo: clean(row[15]),
            sourceFile,
          },
        });
        pcaspRows += 1;
      }
    }
  }

  await executeInBatches(rawStatements);
  await executeInBatches(pcaspStatements);
} catch (error) {
  throw error;
} finally {
  await database.close();
}

console.log(`Linhas brutas importadas/atualizadas: ${rawRows}`);
console.log(`Contas PCASP importadas/atualizadas: ${pcaspRows}`);
console.log("Banco: Turso");

function clean(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function normalizeAccount(value) {
  const raw = clean(value).replace(/\.0$/, "");
  const digits = raw.replace(/\D/g, "");
  return digits ? digits.padStart(9, "0") : "";
}

function normalizeBalanceNature(value) {
  const normalized = normalize(value);
  const hasDebit = normalized.includes("devedora");
  const hasCredit = normalized.includes("credora");

  if (hasDebit && hasCredit) return "D/C";
  if (hasDebit) return "D";
  if (hasCredit) return "C";

  return "";
}
