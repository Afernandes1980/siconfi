import {
  OFFICIAL_FISCAL_DOCUMENTS,
  OFFICIAL_FISCAL_PACKAGE_LABEL,
  OFFICIAL_FISCAL_RULES,
  type OfficialFiscalDocument,
  type OfficialFiscalRule,
} from "@/lib/official-fiscal-rules";
import { DATABASE_SCHEMA, database } from "@/lib/turso";
import type { MscBalanceRow } from "@/lib/msc-balances";

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

export type PowerBody = {
  code: string;
  name: string;
  sourceFile: string;
};

export type MscBalanceDifference = {
  comparisonKey: string;
  keyValues: string[];
  previousRowNumber: number | null;
  currentRowNumber: number | null;
  endingValue: number | null;
  beginningValue: number | null;
  endingNature: string;
  beginningNature: string;
  reason: "different_value" | "different_nature" | "missing_ending" | "missing_beginning";
};

export type MscBalanceComparison = {
  competenceKey: string;
  previousCompetenceKey: string;
  compared: number;
  ignoredZeroBeginning: number;
  storedCompetences: string[];
  exercise: MscExerciseSummary;
  differences: MscBalanceDifference[];
  status: "compared" | "no_previous";
};

export type MscExerciseSummary = {
  year: string;
  storedCompetences: string[];
  transitions: Array<{
    previousCompetenceKey: string;
    competenceKey: string;
    status: "compared" | "pending";
    compared: number;
    ignoredZeroBeginning: number;
    differences: number;
  }>;
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

export async function listPowerBodies() {
  await initializeDatabase();
  const result = await database.execute(`
    SELECT code, name, source_file AS sourceFile
    FROM power_bodies_2026
    ORDER BY code
  `);

  return resultRows<PowerBody>(result);
}

export async function saveAndCompareMscBalances(
  competenceKey: string,
  competenceLabel: string,
  sourceFile: string,
  rows: MscBalanceRow[],
): Promise<MscBalanceComparison> {
  await initializeDatabase();

  await database.batch([
    { sql: "DELETE FROM msc_balance_rows WHERE competence_key = ?", args: [competenceKey] },
    {
      sql: `INSERT INTO msc_balance_imports (competence_key, competence_label, source_file)
            VALUES (?, ?, ?)
            ON CONFLICT(competence_key) DO UPDATE SET
              competence_label = excluded.competence_label,
              source_file = excluded.source_file,
              imported_at = CURRENT_TIMESTAMP`,
      args: [competenceKey, competenceLabel, sourceFile],
    },
  ], "immediate");

  const statements = rows.map((row) => ({
    sql: `INSERT INTO msc_balance_rows (
            competence_key, comparison_key, key_json, value_type, balance_value,
            raw_value, value_nature, row_number
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(competence_key, comparison_key, value_type) DO UPDATE SET
            key_json = excluded.key_json,
            balance_value = excluded.balance_value,
            raw_value = excluded.raw_value,
            value_nature = excluded.value_nature,
            row_number = excluded.row_number`,
    args: [
      competenceKey,
      row.comparisonKey,
      JSON.stringify(row.keyValues),
      row.valueType,
      row.value,
      row.rawValue,
      row.nature,
      row.rowNumber,
    ],
  }));

  for (let index = 0; index < statements.length; index += 400) {
    await database.batch(statements.slice(index, index + 400), "immediate");
  }

  const previousCompetenceKey = previousMonth(competenceKey);
  const previousImport = await database.get(
    "SELECT competence_key FROM msc_balance_imports WHERE competence_key = ? LIMIT 1",
    previousCompetenceKey,
  );
  const storedCompetencesResult = await database.execute(`
    SELECT competence_key AS competenceKey
    FROM msc_balance_imports
    ORDER BY competence_key
  `);
  const storedCompetences = resultRows<{ competenceKey: string }>(storedCompetencesResult)
    .map((item) => item.competenceKey);
  const exercise = await getMscExerciseSummary(competenceKey.slice(0, 4));

  if (!previousImport) {
    return {
      competenceKey,
      previousCompetenceKey,
      compared: 0,
      ignoredZeroBeginning: 0,
      storedCompetences,
      exercise,
      differences: [],
      status: "no_previous",
    };
  }

  const result = await database.execute(
    `SELECT competence_key AS competenceKey, comparison_key AS comparisonKey,
                 key_json AS keyJson, value_type AS valueType, balance_value AS balanceValue,
                 value_nature AS valueNature, row_number AS rowNumber
          FROM msc_balance_rows
          WHERE (competence_key = ? AND value_type = 'ending_balance')
             OR (competence_key = ? AND value_type = 'beginning_balance')`,
    [previousCompetenceKey, competenceKey],
  );
  const balanceRows = resultRows<{
    competenceKey: string;
    comparisonKey: string;
    keyJson: string;
    valueType: string;
    balanceValue: number | null;
    valueNature: string;
    rowNumber: number;
  }>(result);
  const endings = new Map(balanceRows.filter((row) => row.valueType === "ending_balance").map((row) => [row.comparisonKey, row]));
  const beginnings = new Map(balanceRows.filter((row) => row.valueType === "beginning_balance").map((row) => [row.comparisonKey, row]));
  const keys = new Set([...endings.keys(), ...beginnings.keys()]);
  const differences: MscBalanceDifference[] = [];
  let compared = 0;
  let ignoredZeroBeginning = 0;

  for (const comparisonKey of keys) {
    const ending = endings.get(comparisonKey);
    const beginning = beginnings.get(comparisonKey);

    if (beginning?.balanceValue === 0) {
      ignoredZeroBeginning += 1;
      continue;
    }

    if (ending && beginning) compared += 1;

    const reason = !ending
      ? "missing_ending"
      : !beginning
        ? "missing_beginning"
        : ending.valueNature !== beginning.valueNature
          ? "different_nature"
          : ending.balanceValue !== beginning.balanceValue
            ? "different_value"
            : null;
    if (!reason) continue;

    differences.push({
      comparisonKey,
      keyValues: parseJsonStringArray(ending?.keyJson ?? beginning?.keyJson ?? "[]"),
      previousRowNumber: ending ? Number(ending.rowNumber) : null,
      currentRowNumber: beginning ? Number(beginning.rowNumber) : null,
      endingValue: ending?.balanceValue ?? null,
      beginningValue: beginning?.balanceValue ?? null,
      endingNature: ending?.valueNature ?? "",
      beginningNature: beginning?.valueNature ?? "",
      reason,
    });
  }

  return {
    competenceKey,
    previousCompetenceKey,
    compared,
    ignoredZeroBeginning,
    storedCompetences,
    exercise,
    differences,
    status: "compared",
  };
}

export async function getLatestMscExerciseSummary() {
  await initializeDatabase();
  const latest = await database.get(
    "SELECT competence_key AS competenceKey FROM msc_balance_imports ORDER BY competence_key DESC LIMIT 1",
  ) as { competenceKey?: string } | undefined;
  return latest?.competenceKey
    ? getMscExerciseSummary(latest.competenceKey.slice(0, 4))
    : null;
}

async function getMscExerciseSummary(year: string): Promise<MscExerciseSummary> {
  const importsResult = await database.execute(
    `SELECT competence_key AS competenceKey
     FROM msc_balance_imports
     WHERE competence_key LIKE ?
     ORDER BY competence_key`,
    [`${year}-%`],
  );
  const storedCompetences = resultRows<{ competenceKey: string }>(importsResult)
    .map((item) => item.competenceKey);
  const stored = new Set(storedCompetences);
  const balancesResult = await database.execute(
    `SELECT competence_key AS competenceKey, comparison_key AS comparisonKey,
            value_type AS valueType, balance_value AS balanceValue, value_nature AS valueNature
     FROM msc_balance_rows
     WHERE competence_key LIKE ?`,
    [`${year}-%`],
  );
  const balances = resultRows<{
    competenceKey: string;
    comparisonKey: string;
    valueType: string;
    balanceValue: number | null;
    valueNature: string;
  }>(balancesResult);
  const transitions: MscExerciseSummary["transitions"] = [];

  for (let month = 2; month <= 12; month += 1) {
    const previousCompetenceKey = `${year}-${String(month - 1).padStart(2, "0")}`;
    const currentCompetenceKey = `${year}-${String(month).padStart(2, "0")}`;
    if (!stored.has(previousCompetenceKey) || !stored.has(currentCompetenceKey)) {
      transitions.push({
        previousCompetenceKey,
        competenceKey: currentCompetenceKey,
        status: "pending",
        compared: 0,
        ignoredZeroBeginning: 0,
        differences: 0,
      });
      continue;
    }

    const endings = new Map(
      balances
        .filter((row) => row.competenceKey === previousCompetenceKey && row.valueType === "ending_balance")
        .map((row) => [row.comparisonKey, row]),
    );
    const beginnings = new Map(
      balances
        .filter((row) => row.competenceKey === currentCompetenceKey && row.valueType === "beginning_balance")
        .map((row) => [row.comparisonKey, row]),
    );
    const keys = new Set([...endings.keys(), ...beginnings.keys()]);
    let compared = 0;
    let ignoredZeroBeginning = 0;
    let differences = 0;

    for (const key of keys) {
      const ending = endings.get(key);
      const beginning = beginnings.get(key);
      if (beginning?.balanceValue === 0) {
        ignoredZeroBeginning += 1;
        continue;
      }
      if (ending && beginning) compared += 1;
      if (!ending || !beginning || ending.balanceValue !== beginning.balanceValue || ending.valueNature !== beginning.valueNature) {
        differences += 1;
      }
    }

    transitions.push({
      previousCompetenceKey,
      competenceKey: currentCompetenceKey,
      status: "compared",
      compared,
      ignoredZeroBeginning,
      differences,
    });
  }

  return { year, storedCompetences, transitions };
}

function previousMonth(competenceKey: string) {
  const [year, month] = competenceKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
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
