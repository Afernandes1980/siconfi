import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  OFFICIAL_FISCAL_DOCUMENTS,
  OFFICIAL_FISCAL_PACKAGE_LABEL,
  OFFICIAL_FISCAL_RULES,
  type OfficialFiscalDocument,
  type OfficialFiscalRule,
} from "@/lib/official-fiscal-rules";

export type StoredComparisonRule = {
  id: number;
  dimension: string;
  code: string;
  item: string;
  status: string;
  sourceFile: string;
  createdAt: string;
  updatedAt: string;
};

export type AccountNature = {
  accountClass: string;
  nature: "D" | "C";
};

export type PcaspAccount = {
  account: string;
  title: string;
  balanceNature: string;
  normalizedNature: "D" | "C" | "D/C" | "";
  status: string;
  detailedLevel: string;
  financialSurplusIndicator: string;
  complementaryInfoId: string;
  complementaryInfo: string;
  sourceFile: string;
};

export type StoredOfficialFiscalRule = OfficialFiscalRule & {
  packageLabel: string;
};

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "siconfi.sqlite");

let database: DatabaseSync | null = null;

export function getDatabase() {
  mkdirSync(DB_DIR, { recursive: true });

  if (!database) {
    database = new DatabaseSync(DB_PATH);
    initializeDatabase(database);
  }

  return database;
}

export function initializeDatabase(db = getDatabase()) {
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

    CREATE TABLE IF NOT EXISTS account_natures (
      account_class TEXT PRIMARY KEY,
      nature TEXT NOT NULL CHECK (nature IN ('D', 'C')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

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

    CREATE TABLE IF NOT EXISTS official_fiscal_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      report TEXT NOT NULL,
      kind TEXT NOT NULL,
      exercise INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      official_path TEXT NOT NULL,
      package_label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS official_fiscal_rules (
      code TEXT PRIMARY KEY,
      report TEXT NOT NULL,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      description TEXT NOT NULL,
      source_document_ids TEXT NOT NULL,
      package_label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_official_fiscal_rules_report
      ON official_fiscal_rules (report);

    CREATE INDEX IF NOT EXISTS idx_official_fiscal_rules_category
      ON official_fiscal_rules (category);
  `);

  seedAccountNatures(db);
  seedOfficialFiscalPackage(db);
}

function seedAccountNatures(db: DatabaseSync) {
  const defaults: AccountNature[] = [
    { accountClass: "1", nature: "D" },
    { accountClass: "2", nature: "C" },
    { accountClass: "3", nature: "D" },
    { accountClass: "4", nature: "C" },
    { accountClass: "5", nature: "D" },
    { accountClass: "6", nature: "C" },
    { accountClass: "7", nature: "D" },
    { accountClass: "8", nature: "C" },
  ];

  const upsert = db.prepare(`
    INSERT INTO account_natures (account_class, nature)
    VALUES (?, ?)
    ON CONFLICT(account_class) DO UPDATE SET
      nature = excluded.nature,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const item of defaults) {
    upsert.run(item.accountClass, item.nature);
  }
}

export function listComparisonRules() {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
        SELECT
          id,
          dimension,
          code,
          item,
          status,
          source_file AS sourceFile,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM comparison_rules
        ORDER BY dimension, code
      `,
    )
    .all() as StoredComparisonRule[];

  return rows;
}

export function upsertComparisonRule(rule: Omit<StoredComparisonRule, "id" | "createdAt" | "updatedAt">) {
  const db = getDatabase();

  db.prepare(
    `
      INSERT INTO comparison_rules (dimension, code, item, status, source_file)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        dimension = excluded.dimension,
        item = excluded.item,
        status = excluded.status,
        source_file = excluded.source_file,
        updated_at = CURRENT_TIMESTAMP
    `,
  ).run(rule.dimension, rule.code, rule.item, rule.status, rule.sourceFile);
}

export function getComparisonRulesSummary() {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
        SELECT dimension, status, COUNT(*) AS total
        FROM comparison_rules
        GROUP BY dimension, status
        ORDER BY dimension, status
      `,
    )
    .all() as Array<{ dimension: string; status: string; total: number }>;

  return rows;
}

export function listAccountNatures() {
  const db = getDatabase();

  return db
    .prepare(
      `
        SELECT
          account_class AS accountClass,
          nature
        FROM account_natures
        ORDER BY account_class
      `,
    )
    .all() as AccountNature[];
}

export function listPcaspAccounts() {
  const db = getDatabase();

  return db
    .prepare(
      `
        SELECT
          account,
          title,
          balance_nature AS balanceNature,
          normalized_nature AS normalizedNature,
          status,
          detailed_level AS detailedLevel,
          financial_surplus_indicator AS financialSurplusIndicator,
          complementary_info_id AS complementaryInfoId,
          complementary_info AS complementaryInfo,
          source_file AS sourceFile
        FROM pcasp_extended_2026
        ORDER BY account
      `,
    )
    .all() as PcaspAccount[];
}

function seedOfficialFiscalPackage(db: DatabaseSync) {
  const documentUpsert = db.prepare(`
    INSERT INTO official_fiscal_documents (
      id,
      title,
      report,
      kind,
      exercise,
      file_name,
      official_path,
      package_label
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      report = excluded.report,
      kind = excluded.kind,
      exercise = excluded.exercise,
      file_name = excluded.file_name,
      official_path = excluded.official_path,
      package_label = excluded.package_label,
      updated_at = CURRENT_TIMESTAMP
  `);

  const ruleUpsert = db.prepare(`
    INSERT INTO official_fiscal_rules (
      code,
      report,
      category,
      severity,
      description,
      source_document_ids,
      package_label
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      report = excluded.report,
      category = excluded.category,
      severity = excluded.severity,
      description = excluded.description,
      source_document_ids = excluded.source_document_ids,
      package_label = excluded.package_label,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const document of OFFICIAL_FISCAL_DOCUMENTS) {
    documentUpsert.run(
      document.id,
      document.title,
      document.report,
      document.kind,
      document.exercise,
      document.fileName,
      document.officialPath,
      OFFICIAL_FISCAL_PACKAGE_LABEL,
    );
  }

  for (const rule of OFFICIAL_FISCAL_RULES) {
    ruleUpsert.run(
      rule.code,
      rule.report,
      rule.category,
      rule.severity,
      rule.description,
      JSON.stringify(rule.sourceDocumentIds),
      OFFICIAL_FISCAL_PACKAGE_LABEL,
    );
  }
}

export function listOfficialFiscalDocuments() {
  const db = getDatabase();

  const rows = db
    .prepare(
      `
        SELECT
          id,
          title,
          report,
          kind,
          exercise,
          file_name AS fileName,
          official_path AS officialPath
        FROM official_fiscal_documents
        ORDER BY report, kind, title
      `,
    )
    .all() as OfficialFiscalDocument[];

  return rows;
}

export function listOfficialFiscalRules() {
  const db = getDatabase();

  const rows = db
    .prepare(
      `
        SELECT
          code,
          report,
          category,
          severity,
          description,
          source_document_ids AS sourceDocumentIds,
          package_label AS packageLabel
        FROM official_fiscal_rules
        ORDER BY report, category, code
      `,
    )
    .all() as Array<Omit<StoredOfficialFiscalRule, "sourceDocumentIds"> & { sourceDocumentIds: string }>;

  return rows.map((row) => ({
    ...row,
    sourceDocumentIds: parseJsonStringArray(row.sourceDocumentIds),
  })) as StoredOfficialFiscalRule[];
}

function parseJsonStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
