import {
  OFFICIAL_FISCAL_DOCUMENTS,
  OFFICIAL_FISCAL_PACKAGE_LABEL,
  OFFICIAL_FISCAL_RULES,
  type OfficialFiscalDocument,
  type OfficialFiscalRule,
} from "@/lib/official-fiscal-rules";
import { DATABASE_SCHEMA, database } from "@/lib/turso";

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

let initialization: Promise<void> | null = null;

export function initializeDatabase() {
  if (!initialization) {
    initialization = initialize().catch((error) => {
      initialization = null;
      throw error;
    });
  }

  return initialization;
}

async function initialize() {
  await database.exec(DATABASE_SCHEMA);
  await seedAccountNatures();
  await seedOfficialFiscalPackage();
}

async function seedAccountNatures() {
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

  await database.batch(
    defaults.map((item) => ({
      sql: `
        INSERT INTO account_natures (account_class, nature)
        VALUES (:accountClass, :nature)
        ON CONFLICT(account_class) DO UPDATE SET
          nature = excluded.nature,
          updated_at = CURRENT_TIMESTAMP
      `,
      args: { accountClass: item.accountClass, nature: item.nature },
    })),
    "immediate",
  );
}

async function seedOfficialFiscalPackage() {
  await database.batch(
    [
      ...OFFICIAL_FISCAL_DOCUMENTS.map((document) => ({
        sql: `
          INSERT INTO official_fiscal_documents (
            id, title, report, kind, exercise, file_name, official_path, package_label
          ) VALUES (
            :id, :title, :report, :kind, :exercise, :fileName, :officialPath, :packageLabel
          )
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            report = excluded.report,
            kind = excluded.kind,
            exercise = excluded.exercise,
            file_name = excluded.file_name,
            official_path = excluded.official_path,
            package_label = excluded.package_label,
            updated_at = CURRENT_TIMESTAMP
        `,
        args: {
          id: document.id,
          title: document.title,
          report: document.report,
          kind: document.kind,
          exercise: document.exercise,
          fileName: document.fileName,
          officialPath: document.officialPath,
          packageLabel: OFFICIAL_FISCAL_PACKAGE_LABEL,
        },
      })),
      ...OFFICIAL_FISCAL_RULES.map((rule) => ({
        sql: `
          INSERT INTO official_fiscal_rules (
            code, report, category, severity, description, source_document_ids, package_label
          ) VALUES (
            :code, :report, :category, :severity, :description, :sourceDocumentIds, :packageLabel
          )
          ON CONFLICT(code) DO UPDATE SET
            report = excluded.report,
            category = excluded.category,
            severity = excluded.severity,
            description = excluded.description,
            source_document_ids = excluded.source_document_ids,
            package_label = excluded.package_label,
            updated_at = CURRENT_TIMESTAMP
        `,
        args: {
          code: rule.code,
          report: rule.report,
          category: rule.category,
          severity: rule.severity,
          description: rule.description,
          sourceDocumentIds: JSON.stringify(rule.sourceDocumentIds),
          packageLabel: OFFICIAL_FISCAL_PACKAGE_LABEL,
        },
      })),
    ],
    "immediate",
  );
}

export async function listComparisonRules() {
  await initializeDatabase();
  const result = await database.execute(`
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
  `);

  return result.rows as unknown as StoredComparisonRule[];
}

export async function upsertComparisonRule(
  rule: Omit<StoredComparisonRule, "id" | "createdAt" | "updatedAt">,
) {
  await initializeDatabase();
  await database.execute(
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
    [rule.dimension, rule.code, rule.item, rule.status, rule.sourceFile],
  );
}

export async function getComparisonRulesSummary() {
  await initializeDatabase();
  const result = await database.execute(`
    SELECT dimension, status, COUNT(*) AS total
    FROM comparison_rules
    GROUP BY dimension, status
    ORDER BY dimension, status
  `);

  return result.rows as unknown as Array<{ dimension: string; status: string; total: number }>;
}

export async function listAccountNatures() {
  await initializeDatabase();
  const result = await database.execute(`
    SELECT account_class AS accountClass, nature
    FROM account_natures
    ORDER BY account_class
  `);

  return result.rows as unknown as AccountNature[];
}

export async function listPcaspAccounts() {
  await initializeDatabase();
  const result = await database.execute(`
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
  `);

  return result.rows as unknown as PcaspAccount[];
}

export async function listOfficialFiscalDocuments() {
  await initializeDatabase();
  const result = await database.execute(`
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
  `);

  return result.rows as unknown as OfficialFiscalDocument[];
}

export async function listOfficialFiscalRules() {
  await initializeDatabase();
  const result = await database.execute(`
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
  `);
  const rows = result.rows as unknown as Array<
    Omit<StoredOfficialFiscalRule, "sourceDocumentIds"> & { sourceDocumentIds: string }
  >;

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
