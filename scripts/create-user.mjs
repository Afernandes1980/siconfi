import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import { database } from "./turso-client.mjs";

const email = String(process.argv[2] || "").trim().toLowerCase();
const displayName = String(process.argv[3] || "Administrador").trim();

if (!/^\S+@\S+\.\S+$/.test(email)) {
  throw new Error('Informe um e-mail valido. Exemplo: npm run auth:create-user -- "admin@exemplo.com" "Administrador"');
}

const password = process.env.SICONFI_USER_PASSWORD || await promptHidden("Senha: ");
const confirmation = process.env.SICONFI_USER_PASSWORD || await promptHidden("Confirme a senha: ");

if (password !== confirmation) throw new Error("As senhas nao coincidem.");
if (password.length < 12) throw new Error("A senha deve possuir pelo menos 12 caracteres.");
if (password.length > 256) throw new Error("A senha excede o limite de 256 caracteres.");

const passwordHash = await hashPassword(password);

await database.exec(`
  CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

await database.execute(
  `
    INSERT INTO app_users (email, display_name, password_hash, role, active)
    VALUES (?, ?, ?, 'admin', 1)
    ON CONFLICT(email) DO UPDATE SET
      display_name = excluded.display_name,
      password_hash = excluded.password_hash,
      role = excluded.role,
      active = 1,
      updated_at = CURRENT_TIMESTAMP
  `,
  [email, displayName, passwordHash],
);

await database.close();
console.log(`Usuario criado/atualizado: ${email}`);

async function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await promisify(scryptCallback)(value, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

function promptHidden(label) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("Terminal interativo indisponivel. Configure SICONFI_USER_PASSWORD temporariamente.");
  }

  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    function finish() {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
    }

    function onData(chunk) {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish();
          reject(new Error("Operacao cancelada."));
          return;
        }

        if (character === "\r" || character === "\n") {
          finish();
          resolve(value);
          return;
        }

        if (character === "\u007f" || character === "\b") {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }

        if (character >= " ") {
          value += character;
          process.stdout.write("*");
        }
      }
    }

    process.stdin.on("data", onData);
  });
}
