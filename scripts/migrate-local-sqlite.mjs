import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { database, executeInBatches } from "./turso-client.mjs";

const sqlitePath = process.argv[2] || path.join(process.cwd(), "data", "siconfi.sqlite");

if (!existsSync(sqlitePath)) {
  throw new Error(`Banco SQLite local nao encontrado: ${sqlitePath}`);
}

const local = new DatabaseSync(sqlitePath, { readOnly: true });

try {
  const comparisonRules = local.prepare(`
    SELECT dimension, code, item, status, source_file AS sourceFile
    FROM comparison_rules
  `).all();
  const layoutRows = local.prepare(`
    SELECT sheet_name AS sheetName, row_number AS rowNumber,
      row_json AS rowJson, source_file AS sourceFile
    FROM msc_layout_sheets
  `).all();
  const pcaspAccounts = local.prepare(`
    SELECT account, class, group_code AS groupCode, subgroup,
      title_code AS titleCode, subtitle, item, subitem, title,
      function_description AS functionDescription,
      balance_nature AS balanceNature, normalized_nature AS normalizedNature,
      status, detailed_level AS detailedLevel,
      financial_surplus_indicator AS financialSurplusIndicator,
      complementary_info_id AS complementaryInfoId,
      complementary_info AS complementaryInfo, source_file AS sourceFile
    FROM pcasp_extended_2026
  `).all();

  await executeInBatches(comparisonRules.map((row) => ({
    sql: `
      INSERT INTO comparison_rules (dimension, code, item, status, source_file)
      VALUES (:dimension, :code, :item, :status, :sourceFile)
      ON CONFLICT(code) DO UPDATE SET
        dimension = excluded.dimension,
        item = excluded.item,
        status = excluded.status,
        source_file = excluded.source_file,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: row,
  })));

  await executeInBatches(layoutRows.map((row) => ({
    sql: `
      INSERT INTO msc_layout_sheets (sheet_name, row_number, row_json, source_file)
      VALUES (:sheetName, :rowNumber, :rowJson, :sourceFile)
      ON CONFLICT(sheet_name, row_number, source_file) DO UPDATE SET
        row_json = excluded.row_json,
        imported_at = CURRENT_TIMESTAMP
    `,
    args: row,
  })));

  await executeInBatches(pcaspAccounts.map((row) => ({
    sql: `
      INSERT INTO pcasp_extended_2026 (
        account, class, group_code, subgroup, title_code, subtitle, item, subitem,
        title, function_description, balance_nature, normalized_nature, status,
        detailed_level, financial_surplus_indicator, complementary_info_id,
        complementary_info, source_file
      ) VALUES (
        :account, :class, :groupCode, :subgroup, :titleCode, :subtitle, :item, :subitem,
        :title, :functionDescription, :balanceNature, :normalizedNature, :status,
        :detailedLevel, :financialSurplusIndicator, :complementaryInfoId,
        :complementaryInfo, :sourceFile
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
    `,
    args: row,
  })));

  console.log(`Regras migradas: ${comparisonRules.length}`);
  console.log(`Linhas de leiaute migradas: ${layoutRows.length}`);
  console.log(`Contas PCASP migradas: ${pcaspAccounts.length}`);
} finally {
  local.close();
  await database.close();
}
