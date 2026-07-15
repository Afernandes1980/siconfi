import { connect } from "@tursodatabase/serverless";

function requiredEnv(name: "TURSO_DATABASE_URL" | "TURSO_AUTH_TOKEN") {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria nao configurada: ${name}`);
  }

  return value;
}

export function createDatabaseConnection() {
  return connect({
    url: requiredEnv("TURSO_DATABASE_URL"),
    authToken: requiredEnv("TURSO_AUTH_TOKEN"),
  });
}

export const database = createDatabaseConnection();

export const DATABASE_SCHEMA = `
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

  CREATE TABLE IF NOT EXISTS comparison_rule_checks (
    rule_code TEXT NOT NULL,
    period_index INTEGER NOT NULL CHECK (period_index BETWEEN 1 AND 12),
    completed_date TEXT NOT NULL,
    quantity INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (rule_code, period_index),
    FOREIGN KEY (rule_code) REFERENCES comparison_rules(code) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS comparison_rule_periodicities (
    rule_code TEXT PRIMARY KEY,
    periodicity TEXT NOT NULL CHECK (periodicity IN ('monthly', 'bimonthly', 'four_monthly', 'annual', 'not_applicable')),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (rule_code) REFERENCES comparison_rules(code) ON DELETE CASCADE
  );

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

  CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cpf TEXT UNIQUE,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    document TEXT,
    organization_type TEXT NOT NULL DEFAULT 'Prefeitura Municipal',
    state TEXT,
    municipality TEXT,
    email TEXT,
    environment TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('demonstration', 'production')),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ibge_municipalities (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    state_code TEXT NOT NULL,
    state_name TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_ibge_municipalities_name ON ibge_municipalities (name);

  CREATE TABLE IF NOT EXISTS organization_rule_periodicities (
    organization_id INTEGER NOT NULL,
    rule_code TEXT NOT NULL,
    periodicity TEXT NOT NULL CHECK (periodicity IN ('monthly', 'bimonthly', 'four_monthly', 'annual', 'not_applicable')),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, rule_code),
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (rule_code) REFERENCES comparison_rules(code) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS organization_rule_checks (
    organization_id INTEGER NOT NULL,
    rule_code TEXT NOT NULL,
    period_index INTEGER NOT NULL CHECK (period_index BETWEEN 1 AND 12),
    completed_date TEXT NOT NULL,
    quantity INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (organization_id, rule_code, period_index),
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (rule_code) REFERENCES comparison_rules(code) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS app_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    organization_id INTEGER,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_app_sessions_user_id
    ON app_sessions (user_id);

  CREATE INDEX IF NOT EXISTS idx_app_sessions_expires_at
    ON app_sessions (expires_at);
`;
