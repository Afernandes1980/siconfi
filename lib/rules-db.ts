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

export type ComparisonRuleCheck = {
  ruleCode: string;
  periodIndex: number;
  completedDate: string;
  quantity: number | null;
};

export type ComparisonRulePeriodicity = {
  ruleCode: string;
  periodicity: "monthly" | "bimonthly" | "four_monthly" | "annual" | "not_applicable";
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

function resultRows<T>(result: { columns: string[]; rows: unknown[][] }): T[] {
  return result.rows.map((row) =>
    Object.fromEntries(result.columns.map((column, index) => [column, row[index]])),
  ) as T[];
}

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
  await migrateAppUsersCpf();
  await migrateComparisonRulePeriodicities();
  await migrateComparisonRuleCheckQuantities();
  await migrateOrganizations();
  await seedAccountNatures();
  await seedOfficialFiscalPackage();
}

async function migrateOrganizations() {
  const result = await database.execute("PRAGMA table_info(app_sessions)");
  const hasOrganizationId = result.rows.some((row: unknown[]) => String(row[1]) === "organization_id");
  if (!hasOrganizationId) await database.execute("ALTER TABLE app_sessions ADD COLUMN organization_id INTEGER");
  await database.execute(`
    INSERT INTO organizations (code, name, organization_type, environment, active)
    VALUES ('DEMO', 'Ambiente de Demonstração', 'Prefeitura Municipal', 'demonstration', 1)
    ON CONFLICT(code) DO NOTHING
  `);
  await database.execute(`
    INSERT OR IGNORE INTO organization_rule_periodicities (organization_id, rule_code, periodicity, updated_at)
    SELECT o.id, p.rule_code, p.periodicity, p.updated_at
    FROM comparison_rule_periodicities p JOIN organizations o ON o.code = 'DEMO'
  `);
  await database.execute(`
    INSERT OR IGNORE INTO organization_rule_checks (organization_id, rule_code, period_index, completed_date, quantity, updated_at)
    SELECT o.id, c.rule_code, c.period_index, c.completed_date, c.quantity, c.updated_at
    FROM comparison_rule_checks c JOIN organizations o ON o.code = 'DEMO'
  `);
}

async function migrateAppUsersCpf() {
  const result = await database.execute("PRAGMA table_info(app_users)");
  const hasCpf = result.rows.some((row: unknown[]) => String(row[1]) === "cpf");
  if (!hasCpf) await database.execute("ALTER TABLE app_users ADD COLUMN cpf TEXT");
  await database.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_cpf ON app_users (cpf)");
}

async function migrateComparisonRuleCheckQuantities() {
  const result = await database.execute("PRAGMA table_info(comparison_rule_checks)");
  const hasQuantity = result.rows.some((row: unknown[]) => String(row[1]) === "quantity");
  if (!hasQuantity) await database.execute("ALTER TABLE comparison_rule_checks ADD COLUMN quantity INTEGER");
}

async function migrateComparisonRulePeriodicities() {
  const result = await database.execute(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'comparison_rule_periodicities'",
  );
  const tableSql = String(result.rows[0]?.[0] ?? "");

  if (!tableSql || tableSql.includes("not_applicable")) return;

  await database.exec(`
    ALTER TABLE comparison_rule_periodicities RENAME TO comparison_rule_periodicities_legacy;
    CREATE TABLE comparison_rule_periodicities (
      rule_code TEXT PRIMARY KEY,
      periodicity TEXT NOT NULL CHECK (periodicity IN ('monthly', 'bimonthly', 'four_monthly', 'annual', 'not_applicable')),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rule_code) REFERENCES comparison_rules(code) ON DELETE CASCADE
    );
    INSERT INTO comparison_rule_periodicities (rule_code, periodicity, updated_at)
      SELECT rule_code, periodicity, updated_at FROM comparison_rule_periodicities_legacy;
    DROP TABLE comparison_rule_periodicities_legacy;
  `);
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

  return resultRows<StoredComparisonRule>(result);
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

export async function listComparisonRuleChecks(organizationId: number) {
  await initializeDatabase();
  const result = await database.execute(`
    SELECT rule_code AS ruleCode, period_index AS periodIndex, completed_date AS completedDate, quantity
    FROM organization_rule_checks
    WHERE organization_id = ?
    ORDER BY rule_code, period_index
  `, [organizationId]);

  return resultRows<ComparisonRuleCheck>(result);
}

export async function listComparisonRulePeriodicities(organizationId: number) {
  await initializeDatabase();
  const result = await database.execute(`
    SELECT rule_code AS ruleCode, periodicity
    FROM organization_rule_periodicities
    WHERE organization_id = ?
    ORDER BY rule_code
  `, [organizationId]);

  return resultRows<ComparisonRulePeriodicity>(result);
}

export async function saveComparisonRuleChecks(
  organizationId: number,
  ruleCode: string,
  periodicity: ComparisonRulePeriodicity["periodicity"],
  dates: string[],
  quantities: Array<number | null>,
) {
  await initializeDatabase();
  await database.batch(
    [{
      sql: "INSERT INTO organization_rule_periodicities (organization_id, rule_code, periodicity) VALUES (?, ?, ?) ON CONFLICT(organization_id, rule_code) DO UPDATE SET periodicity = excluded.periodicity, updated_at = CURRENT_TIMESTAMP",
      args: [organizationId, ruleCode, periodicity],
    }, {
      sql: "DELETE FROM organization_rule_checks WHERE organization_id = ? AND rule_code = ? AND period_index > ?",
      args: [organizationId, ruleCode, dates.length],
    }, ...dates.map((completedDate, index) => completedDate || quantities[index] !== null
      ? {
          sql: `INSERT INTO organization_rule_checks (organization_id, rule_code, period_index, completed_date, quantity)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(organization_id, rule_code, period_index) DO UPDATE SET
                  completed_date = excluded.completed_date, quantity = excluded.quantity, updated_at = CURRENT_TIMESTAMP`,
          args: [organizationId, ruleCode, index + 1, completedDate, quantities[index]],
        }
      : {
          sql: "DELETE FROM organization_rule_checks WHERE organization_id = ? AND rule_code = ? AND period_index = ?",
          args: [organizationId, ruleCode, index + 1],
        })],
    "immediate",
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

  return resultRows<{ dimension: string; status: string; total: number }>(result);
}

export async function listAccountNatures() {
  await initializeDatabase();
  const result = await database.execute(`
    SELECT account_class AS accountClass, nature
    FROM account_natures
    ORDER BY account_class
  `);

  return resultRows<AccountNature>(result);
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

  return resultRows<PcaspAccount>(result);
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

  return resultRows<OfficialFiscalDocument>(result);
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
  const rows = resultRows<
    Omit<StoredOfficialFiscalRule, "sourceDocumentIds"> & { sourceDocumentIds: string }
  >(result);

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
