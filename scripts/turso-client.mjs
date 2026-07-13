import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { connect } from "@tursodatabase/serverless";

if (existsSync(".env.local")) loadEnvFile(".env.local");

const url = process.env.TURSO_DATABASE_URL?.trim();
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (!url || !authToken) {
  throw new Error(
    "Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no ambiente ou no arquivo .env.local.",
  );
}

export const database = connect({ url, authToken });

export async function executeInBatches(statements, size = 200) {
  for (let index = 0; index < statements.length; index += size) {
    await database.batch(statements.slice(index, index + size), "immediate");
  }
}
