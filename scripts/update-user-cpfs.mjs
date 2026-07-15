import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { connect } from "@tursodatabase/serverless";

if (existsSync(".env.local")) loadEnvFile(".env.local");

const database = connect({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

try {
  await database.execute("ALTER TABLE app_users ADD COLUMN cpf TEXT");
} catch (error) {
  if (!String(error).toLowerCase().includes("duplicate column")) throw error;
}

await database.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_cpf ON app_users (cpf)");
await database.execute(
  "UPDATE app_users SET cpf = ?, updated_at = CURRENT_TIMESTAMP WHERE lower(display_name) LIKE 'alan%'",
  ["03874149404"],
);
await database.execute(
  "UPDATE app_users SET cpf = ?, updated_at = CURRENT_TIMESTAMP WHERE lower(display_name) LIKE 'mika%'",
  ["04914685558"],
);

const result = await database.execute(`
  SELECT display_name AS nome, cpf
  FROM app_users
  WHERE lower(display_name) LIKE 'alan%' OR lower(display_name) LIKE 'mika%'
  ORDER BY display_name
`);

console.log(result.rows);
await database.close();
