import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env.local")) loadEnvFile(".env.local");

// O import dinamico ocorre depois do carregamento do .env.local.
const { DATABASE_SCHEMA, database } = await import("../lib/turso.ts");

await database.exec(DATABASE_SCHEMA);
await database.execute(`
  INSERT OR IGNORE INTO organization_msc_imports
    (organization_id, competence_key, competence_label, source_file, imported_at)
  SELECT o.id, i.competence_key, i.competence_label, i.source_file, i.imported_at
  FROM msc_balance_imports i JOIN organizations o ON o.code = 'DEMO'
`);
await database.execute(`
  INSERT OR IGNORE INTO organization_msc_rows
    (organization_id, competence_key, comparison_key, key_json, value_type, balance_value, raw_value, value_nature, row_number)
  SELECT o.id, r.competence_key, r.comparison_key, r.key_json, r.value_type,
         r.balance_value, r.raw_value, r.value_nature, r.row_number
  FROM msc_balance_rows r JOIN organizations o ON o.code = 'DEMO'
`);
await database.execute(`
  INSERT OR IGNORE INTO organization_msc_power_body_usage
    (organization_id, competence_key, code, occurrence_count)
  SELECT o.id, u.competence_key, u.code, u.occurrence_count
  FROM msc_power_body_usage u JOIN organizations o ON o.code = 'DEMO'
`);
await database.execute(`
  INSERT OR IGNORE INTO organization_msc_power_body_rows
    (organization_id, competence_key, code, row_signature, occurrence_count)
  SELECT o.id, r.competence_key, r.code, r.row_signature, r.occurrence_count
  FROM msc_power_body_rows r JOIN organizations o ON o.code = 'DEMO'
`);

const accountNatures = [
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
  accountNatures.map((args) => ({
    sql: `
      INSERT INTO account_natures (account_class, nature)
      VALUES (:accountClass, :nature)
      ON CONFLICT(account_class) DO UPDATE SET
        nature = excluded.nature,
        updated_at = CURRENT_TIMESTAMP
    `,
    args,
  })),
  "immediate",
);

await database.close();
console.log("Esquema do banco Turso criado/atualizado com sucesso.");
