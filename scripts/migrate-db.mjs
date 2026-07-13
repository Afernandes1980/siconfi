import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

if (existsSync(".env.local")) loadEnvFile(".env.local");

// O import dinamico ocorre depois do carregamento do .env.local.
const { DATABASE_SCHEMA, database } = await import("../lib/turso.ts");

await database.exec(DATABASE_SCHEMA);

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
