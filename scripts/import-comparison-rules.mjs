import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { strFromU8, unzipSync } from "fflate";

const inputFile = process.argv[2] || findDefaultFile();
const dbPath = path.join(process.cwd(), "data", "siconfi.sqlite");

if (!inputFile || !existsSync(inputFile)) {
  console.error(`Arquivo nao encontrado: ${inputFile || "(nao informado)"}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS comparison_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dimension TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    item TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDENTE',
    source_file TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_comparison_rules_dimension
    ON comparison_rules (dimension);

  CREATE INDEX IF NOT EXISTS idx_comparison_rules_status
    ON comparison_rules (status);
`);

const workbook = readWorkbook(inputFile);
const upsert = db.prepare(`
  INSERT INTO comparison_rules (dimension, code, item, status, source_file)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(code) DO UPDATE SET
    dimension = excluded.dimension,
    item = excluded.item,
    status = excluded.status,
    source_file = excluded.source_file,
    updated_at = CURRENT_TIMESTAMP
`);

let imported = 0;

for (const sheet of workbook.sheets) {
  for (const row of sheet.rows.slice(1)) {
    const dimension = clean(row[0]);
    const code = clean(row[1]);
    const item = clean(row[2]);
    const status = clean(row[3]) || "PENDENTE";

    if (!dimension || !code || !item) continue;

    upsert.run(dimension, code, item, status, path.basename(inputFile));
    imported += 1;
  }
}

db.close();
console.log(`Regras importadas/atualizadas: ${imported}`);
console.log(`Banco: ${dbPath}`);

function findDefaultFile() {
  const downloads = path.join(process.env.USERPROFILE || "", "Downloads");
  if (!downloads || !existsSync(downloads)) return "";

  const fileName = readdirSync(downloads).find((name) =>
    /^checklist_STN_dimensoes- 2025.*\.xlsx$/i.test(name),
  );

  return fileName ? path.join(downloads, fileName) : "";
}

function readWorkbook(filePath) {
  const entries = unzipSync(new Uint8Array(readFileSync(filePath)));
  const sharedStrings = readSharedStrings(entries);
  const workbookXml = readXml(entries, "xl/workbook.xml");
  const workbookRelsXml = readXml(entries, "xl/_rels/workbook.xml.rels");
  const rels = new Map(
    [...workbookRelsXml.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
  const sheets = [];

  for (const match of workbookXml.matchAll(/<sheet[^>]+name="([^"]+)"[^>]+r:id="([^"]+)"/g)) {
    const name = decodeXml(match[1]);
    const relTarget = rels.get(match[2]);
    if (!relTarget) continue;

    const target = relTarget.startsWith("xl/") ? relTarget : `xl/${relTarget}`;
    sheets.push({
      name,
      rows: readSheetRows(entries, target, sharedStrings),
    });
  }

  return { sheets };
}

function readSharedStrings(entries) {
  if (!entries["xl/sharedStrings.xml"]) return [];

  const xml = strFromU8(entries["xl/sharedStrings.xml"]);
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((textMatch) => decodeXml(textMatch[1]))
      .join(""),
  );
}

function readSheetRows(entries, entryName, sharedStrings) {
  const xml = readXml(entries, entryName);
  const rows = [];

  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const values = [];

    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const cellRef = /r="([A-Z]+)\d+"/.exec(attrs)?.[1] || "A";
      const index = columnIndex(cellRef);

      while (values.length < index) values.push("");
      values.push(readCellValue(attrs, body, sharedStrings));
    }

    rows.push(values);
  }

  return rows;
}

function readCellValue(attrs, body, sharedStrings) {
  const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] || "";

  if (/t="s"/.test(attrs)) {
    const index = Number(value);
    return Number.isInteger(index) ? sharedStrings[index] || "" : "";
  }

  if (/t="inlineStr"/.test(attrs)) {
    return [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
  }

  return decodeXml(value);
}

function readXml(entries, entryName) {
  const entry = entries[entryName];
  if (!entry) throw new Error(`Entrada nao encontrada no XLSX: ${entryName}`);
  return strFromU8(entry);
}

function columnIndex(column) {
  return [...column].reduce((acc, char) => acc * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function clean(value) {
  return String(value ?? "").trim();
}

function decodeXml(value) {
  return String(value ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
