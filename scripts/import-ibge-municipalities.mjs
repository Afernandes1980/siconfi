import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { connect } from "@tursodatabase/serverless";

if (existsSync(".env.local")) loadEnvFile(".env.local");
const response = await fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome");
if (!response.ok) throw new Error(`IBGE respondeu com HTTP ${response.status}`);
const municipalities = await response.json();
const database = connect({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
await database.exec(`
  CREATE TABLE IF NOT EXISTS ibge_municipalities (
    code TEXT PRIMARY KEY, name TEXT NOT NULL, state_code TEXT NOT NULL, state_name TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_ibge_municipalities_name ON ibge_municipalities (name);
`);
const statements = municipalities.map((municipality) => {
  const state = municipality.microrregiao?.mesorregiao?.UF ?? municipality["regiao-imediata"]?.["regiao-intermediaria"]?.UF;
  if (!state) throw new Error(`UF não encontrada para o município ${municipality.id}`);
  return { sql: `INSERT INTO ibge_municipalities (code, name, state_code, state_name) VALUES (?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET name = excluded.name, state_code = excluded.state_code, state_name = excluded.state_name, updated_at = CURRENT_TIMESTAMP`, args: [String(municipality.id), municipality.nome, state.sigla, state.nome] };
});
for (let index = 0; index < statements.length; index += 200) await database.batch(statements.slice(index, index + 200), "immediate");
const count = await database.execute("SELECT COUNT(*) AS total FROM ibge_municipalities");
console.log(`Municípios IBGE importados: ${count.rows[0]?.[0]}`);
await database.close();
