import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import xlsx from "xlsx";

const inputFile = process.argv[2];
const dbPath = path.join(process.cwd(), "data", "siconfi.sqlite");

if (!inputFile || !existsSync(inputFile)) {
  console.error(`Arquivo nao encontrado: ${inputFile || "(nao informado)"}`);
  process.exit(1);
}

const sourceFile = path.basename(inputFile);
const workbook = xlsx.readFile(inputFile, { cellDates: false });
const db = new DatabaseSync(dbPath);

db.exec(`
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

const insertRawRow = db.prepare(`
  INSERT INTO msc_layout_sheets (sheet_name, row_number, row_json, source_file)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(sheet_name, row_number, source_file) DO UPDATE SET
    row_json = excluded.row_json,
    imported_at = CURRENT_TIMESTAMP
`);

const upsertPcasp = db.prepare(`
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
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
`);

let rawRows = 0;
let pcaspRows = 0;

db.exec("BEGIN");

try {
  for (const sheetName of workbook.SheetNames) {
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });

    rows.forEach((row, index) => {
      insertRawRow.run(sheetName, index + 1, JSON.stringify(row.map(clean)), sourceFile);
      rawRows += 1;
    });

    if (normalize(sheetName) === "pcaspestendido2026") {
      for (const row of rows.slice(4)) {
        const account = normalizeAccount(row[7]);
        if (!account) continue;

        const balanceNature = clean(row[10]);
        upsertPcasp.run(
          account,
          clean(row[0]),
          clean(row[1]),
          clean(row[2]),
          clean(row[3]),
          clean(row[4]),
          clean(row[5]),
          clean(row[6]),
          clean(row[8]),
          clean(row[9]),
          balanceNature,
          normalizeBalanceNature(balanceNature),
          clean(row[11]),
          clean(row[12]),
          clean(row[13]),
          clean(row[14]),
          clean(row[15]),
          sourceFile,
        );
        pcaspRows += 1;
      }
    }
  }

  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

console.log(`Linhas brutas importadas/atualizadas: ${rawRows}`);
console.log(`Contas PCASP importadas/atualizadas: ${pcaspRows}`);
console.log(`Banco: ${dbPath}`);

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
