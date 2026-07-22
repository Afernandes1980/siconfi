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
const requestedSheet = workbook.SheetNames.find((name) => normalize(name) === "fr2026");
const sheetName = requestedSheet ?? workbook.SheetNames[0];
const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
  header: 1,
  defval: "",
  raw: false,
});

const initialCodes = [];
const mainSources = [];
let section = "";
let category = "";

for (const row of rows) {
  const first = clean(row[0]);
  const name = clean(row[1]);
  const normalized = normalize(first);

  if (normalized === "codigoinicial") {
    section = "initial";
    continue;
  }
  if (normalized === "codigofonteprincipal") {
    section = "main";
    continue;
  }
  if (!first || normalized === "codigo" || normalized === "codigoprincipal") continue;

  if (section === "initial" && /^\d$/.test(first) && name) {
    initialCodes.push({ code: first, name });
    continue;
  }

  if (section !== "main") continue;
  if (/^\d{3}$/.test(first) && name) {
    mainSources.push({ code: first, name, category });
  } else if (!name) {
    category = first;
  }
}

if (initialCodes.length === 0 || mainSources.length === 0) {
  throw new Error("A planilha nao contem os blocos CODIGO INICIAL e CODIGO FONTE PRINCIPAL esperados.");
}

await database.exec(`
  CREATE TABLE IF NOT EXISTS resource_sources_2026 (
    code TEXT PRIMARY KEY,
    initial_code TEXT NOT NULL,
    initial_name TEXT NOT NULL,
    main_code TEXT NOT NULL,
    main_name TEXT NOT NULL,
    category TEXT NOT NULL,
    source_file TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_resource_sources_2026_main_code
    ON resource_sources_2026 (main_code);
  CREATE INDEX IF NOT EXISTS idx_resource_sources_2026_category
    ON resource_sources_2026 (category);
`);

const statements = initialCodes.flatMap((initial) => mainSources.map((main) => ({
  sql: `INSERT INTO resource_sources_2026 (
          code, initial_code, initial_name, main_code, main_name, category, source_file
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          initial_code = excluded.initial_code,
          initial_name = excluded.initial_name,
          main_code = excluded.main_code,
          main_name = excluded.main_name,
          category = excluded.category,
          source_file = excluded.source_file,
          updated_at = CURRENT_TIMESTAMP`,
  args: [
    `${initial.code}${main.code}`,
    initial.code,
    initial.name,
    main.code,
    main.name,
    main.category,
    sourceFile,
  ],
})));

await executeInBatches(statements);

console.log(`Aba: ${sheetName}`);
console.log(`Codigos iniciais: ${initialCodes.length}`);
console.log(`Fontes principais: ${mainSources.length}`);
console.log(`Fontes completas importadas: ${statements.length}`);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}
