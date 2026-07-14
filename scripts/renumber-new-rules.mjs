import { database } from "./turso-client.mjs";

const result = await database.execute(`
  SELECT id, dimension, code, item, status, source_file AS sourceFile
  FROM comparison_rules
  ORDER BY dimension, code
`);

const rows = result.rows.map((row) => Object.fromEntries(
  result.columns.map((column, index) => [column, row[index]]),
));

const provisionalPattern = /^nova[_ -]?(d[1-4])[_ -]?([ivxlcdm]+|\d+)$/i;
const canonicalPattern = /^(d[1-4])_(\d+)$/i;

function romanToNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const numbers = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  return [...value.toLowerCase()].reduceRight((total, letter, index, letters) =>
    total + (numbers[letter] < (numbers[letters[index + 1]] ?? 0) ? -numbers[letter] : numbers[letter]), 0);
}

const lastByDimension = new Map();
for (const row of rows) {
  const match = String(row.code).match(canonicalPattern);
  if (!match) continue;
  const dimension = match[1].toUpperCase();
  lastByDimension.set(dimension, Math.max(lastByDimension.get(dimension) ?? 0, Number(match[2])));
}

const provisional = rows
  .map((row) => ({ row, match: String(row.code).match(provisionalPattern) }))
  .filter((entry) => entry.match)
  .sort((left, right) => {
    const dimensionOrder = left.match[1].localeCompare(right.match[1]);
    return dimensionOrder || romanToNumber(left.match[2]) - romanToNumber(right.match[2]);
  });

const nextByDimension = new Map(lastByDimension);
const changes = provisional.map(({ row, match }) => {
  const dimension = match[1].toUpperCase();
  const next = (nextByDimension.get(dimension) ?? 0) + 1;
  nextByDimension.set(dimension, next);
  return { ...row, dimension, oldCode: row.code, newCode: `${dimension}_${String(next).padStart(5, "0")}` };
});

console.table(changes.map(({ dimension, oldCode, newCode, item }) => ({ dimension, oldCode, newCode, item })));

if (process.argv.includes("--apply") && changes.length) {
  const statements = changes.flatMap((change) => [
    {
      sql: `INSERT INTO comparison_rules (dimension, code, item, status, source_file)
            VALUES (?, ?, ?, ?, ?)`,
      args: [change.dimension, change.newCode, change.item, change.status, change.sourceFile],
    },
    {
      sql: `INSERT INTO comparison_rule_periodicities (rule_code, periodicity, updated_at)
            SELECT ?, periodicity, updated_at FROM comparison_rule_periodicities WHERE rule_code = ?`,
      args: [change.newCode, change.oldCode],
    },
    {
      sql: `INSERT INTO comparison_rule_checks (rule_code, period_index, completed_date, updated_at)
            SELECT ?, period_index, completed_date, updated_at FROM comparison_rule_checks WHERE rule_code = ?`,
      args: [change.newCode, change.oldCode],
    },
    { sql: "DELETE FROM comparison_rule_checks WHERE rule_code = ?", args: [change.oldCode] },
    { sql: "DELETE FROM comparison_rule_periodicities WHERE rule_code = ?", args: [change.oldCode] },
    { sql: "DELETE FROM comparison_rules WHERE code = ?", args: [change.oldCode] },
  ]);
  await database.batch(statements, "immediate");
  console.log(`${changes.length} regras renumeradas com sucesso.`);
}

if (!changes.length) console.log("Nenhuma regra provisoria encontrada.");
else if (!process.argv.includes("--apply")) console.log("Simulacao concluida; use --apply para confirmar.");

await database.close();
