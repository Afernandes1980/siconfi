import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { connect } from "@tursodatabase/serverless";

if (existsSync(".env.local")) loadEnvFile(".env.local");
const database = connect({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

await database.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, document TEXT,
    organization_type TEXT NOT NULL DEFAULT 'Prefeitura Municipal', state TEXT, municipality TEXT, email TEXT,
    environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('demonstration', 'production')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS organization_rule_periodicities (
    organization_id INTEGER NOT NULL, rule_code TEXT NOT NULL,
    periodicity TEXT NOT NULL CHECK (periodicity IN ('monthly', 'bimonthly', 'four_monthly', 'annual', 'not_applicable')),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (organization_id, rule_code)
  );
  CREATE TABLE IF NOT EXISTS organization_rule_checks (
    organization_id INTEGER NOT NULL, rule_code TEXT NOT NULL, period_index INTEGER NOT NULL,
    completed_date TEXT NOT NULL, quantity INTEGER, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, rule_code, period_index)
  );
`);
try { await database.execute("ALTER TABLE app_sessions ADD COLUMN organization_id INTEGER"); } catch (error) { if (!String(error).toLowerCase().includes("duplicate column")) throw error; }
await database.execute("INSERT INTO organizations (code, name, organization_type, environment, active) VALUES ('DEMO', 'Ambiente de Demonstração', 'Prefeitura Municipal', 'demonstration', 1) ON CONFLICT(code) DO NOTHING");
await database.execute("INSERT OR IGNORE INTO organization_rule_periodicities (organization_id, rule_code, periodicity, updated_at) SELECT o.id, p.rule_code, p.periodicity, p.updated_at FROM comparison_rule_periodicities p JOIN organizations o ON o.code = 'DEMO'");
await database.execute("INSERT OR IGNORE INTO organization_rule_checks (organization_id, rule_code, period_index, completed_date, quantity, updated_at) SELECT o.id, c.rule_code, c.period_index, c.completed_date, c.quantity, c.updated_at FROM comparison_rule_checks c JOIN organizations o ON o.code = 'DEMO'");
const result = await database.execute("SELECT id, code, name, environment, active FROM organizations ORDER BY id");
console.log(result.rows);
await database.close();
