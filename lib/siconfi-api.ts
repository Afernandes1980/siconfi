const SICONFI_BASE_URL = "https://apidatalake.tesouro.gov.br/ords/cdwhprd/siconfi/tt";

export const siconfiResources = {
  entes: { required: [] },
  "anexos-relatorios": { required: [] },
  extrato_entregas: { required: ["id_ente", "an_referencia"] },
  dca: { required: ["an_exercicio", "id_ente"] },
  rreo: { required: ["an_exercicio", "nr_periodo", "co_tipo_demonstrativo", "id_ente"] },
  rgf: { required: ["an_exercicio", "in_periodicidade", "nr_periodo", "co_tipo_demonstrativo", "co_poder", "id_ente"] },
  msc_patrimonial: { required: ["id_ente", "an_referencia", "me_referencia", "co_tipo_matriz", "classe_conta", "id_tv"] },
  msc_orcamentaria: { required: ["id_ente", "an_referencia", "me_referencia", "co_tipo_matriz", "classe_conta", "id_tv"] },
  msc_controle: { required: ["id_ente", "an_referencia", "me_referencia", "co_tipo_matriz", "classe_conta", "id_tv"] },
} as const;

export type SiconfiResource = keyof typeof siconfiResources;

const allowedParameters = new Set([
  "id_ente", "an_referencia", "an_exercicio", "me_referencia", "nr_periodo",
  "co_tipo_demonstrativo", "no_anexo", "co_esfera", "co_poder", "in_periodicidade",
  "co_tipo_matriz", "classe_conta", "id_tv", "limit", "offset",
]);

let nextRequestAt = 0;
let requestQueue = Promise.resolve();

export class SiconfiApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

export function isSiconfiResource(value: string): value is SiconfiResource {
  return Object.hasOwn(siconfiResources, value);
}

export function validateSiconfiQuery(resource: SiconfiResource, input: URLSearchParams) {
  const query = new URLSearchParams();
  for (const [key, rawValue] of input) {
    if (!allowedParameters.has(key)) throw new SiconfiApiError(`Parametro nao permitido: ${key}.`, 400);
    const value = rawValue.trim();
    if (value) query.append(key, value);
  }

  const missing = siconfiResources[resource].required.filter((name) => !query.get(name));
  if (missing.length) throw new SiconfiApiError(`Parametros obrigatorios: ${missing.join(", ")}.`, 400);

  validateInteger(query, "id_ente", 1);
  validateInteger(query, "an_referencia", 2000, 2100);
  validateInteger(query, "an_exercicio", 2000, 2100);
  validateInteger(query, "me_referencia", 1, 12);
  validateInteger(query, "nr_periodo", 1, 6);
  validateInteger(query, "limit", 1, 5000);
  validateInteger(query, "offset", 0);
  validateEnum(query, "co_tipo_matriz", ["MSCC", "MSCE"]);
  validateEnum(query, "id_tv", ["beginning_balance", "period_change", "ending_balance"]);
  validateEnum(query, "in_periodicidade", ["Q", "S"]);
  validateEnum(query, "co_poder", ["E", "L", "J", "M", "D"]);
  validateEnum(query, "co_esfera", ["M", "E", "U", "C"]);

  const accountClasses: Partial<Record<SiconfiResource, string[]>> = {
    msc_patrimonial: ["1", "2", "3", "4"],
    msc_orcamentaria: ["5", "6"],
    msc_controle: ["7", "8"],
  };
  if (accountClasses[resource]) validateEnum(query, "classe_conta", accountClasses[resource]!);
  return query;
}

export async function fetchSiconfi(resource: SiconfiResource, query: URLSearchParams) {
  const url = `${SICONFI_BASE_URL}/${resource}?${query.toString()}`;
  return enqueue(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      const responseText = await response.text();
      let body: unknown;
      try { body = responseText ? JSON.parse(responseText) : null; } catch { body = responseText; }
      if (response.ok) return body;
      if ((response.status === 400 || response.status === 429) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1100 + Math.floor(Math.random() * 400)));
        continue;
      }
      throw new SiconfiApiError("O Siconfi recusou a consulta.", response.status, body);
    }
    throw new SiconfiApiError("O Siconfi não respondeu à consulta.", 502);
  });
}

function enqueue<T>(operation: () => Promise<T>) {
  const result = requestQueue.then(async () => {
    const wait = Math.max(0, nextRequestAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    nextRequestAt = Date.now() + 1000;
    return operation();
  });
  requestQueue = result.then(() => undefined, () => undefined);
  return result;
}

function validateInteger(query: URLSearchParams, name: string, min: number, max = Number.MAX_SAFE_INTEGER) {
  const value = query.get(name);
  if (value === null) return;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new SiconfiApiError(`Parametro invalido: ${name}.`, 400);
  }
}

function validateEnum(query: URLSearchParams, name: string, allowed: string[]) {
  const value = query.get(name);
  if (value !== null && !allowed.includes(value)) {
    throw new SiconfiApiError(`Parametro invalido: ${name}. Valores aceitos: ${allowed.join(", ")}.`, 400);
  }
}
