import { fetchSiconfi, type SiconfiResource } from "@/lib/siconfi-api";
import type { RreoDelivery } from "@/lib/rreo-timeliness";

type MscApiRow = { valor?: number | string | null };
type MscApiResponse = { items?: MscApiRow[]; hasMore?: boolean; offset?: number; limit?: number };

export type MscNegativeValuesEvaluation = {
  ruleCode: "D1_00017";
  exercise: number;
  month: number | null;
  deliveryDate: string | null;
  checkedRows: number;
  hasNegativeValues: boolean;
  points: 0 | 1;
  classification: "total" | "pending";
};

const VALUE_TYPES = ["beginning_balance", "period_change", "ending_balance"] as const;
const RESOURCE_CLASSES: Array<{ resource: SiconfiResource; classes: string[] }> = [
  { resource: "msc_patrimonial", classes: ["1", "2", "3", "4"] },
  { resource: "msc_orcamentaria", classes: ["5", "6"] },
  { resource: "msc_controle", classes: ["7", "8"] },
];

export async function evaluateLatestMscNegativeValues(exercise: number, entityId: string, deliveries: RreoDelivery[]): Promise<MscNegativeValuesEvaluation> {
  const latest = deliveries
    .filter((item) => item.periodicidade === "M" && normalize(item.entregavel).includes("msc agregada") && Number(item.periodo) >= 1 && Number(item.periodo) <= 12 && item.data_status)
    .sort((a, b) => String(b.data_status).localeCompare(String(a.data_status)))[0];

  if (!latest) return result(exercise, null, null, 0, false, false);

  const month = Number(latest.periodo);
  let checkedRows = 0;
  for (const { resource, classes } of RESOURCE_CLASSES) {
    for (const accountClass of classes) {
      for (const valueType of VALUE_TYPES) {
        let offset = 0;
        do {
          const query = new URLSearchParams({
            id_ente: entityId,
            an_referencia: String(exercise),
            me_referencia: String(month),
            co_tipo_matriz: "MSCC",
            classe_conta: accountClass,
            id_tv: valueType,
            limit: "5000",
            offset: String(offset),
          });
          const response = await fetchSiconfi(resource, query) as MscApiResponse;
          const items = response.items ?? [];
          checkedRows += items.length;
          if (items.some((item) => Number(item.valor) < 0)) {
            return result(exercise, month, latest.data_status ?? null, checkedRows, true, true);
          }
          if (!response.hasMore || items.length === 0) break;
          offset += response.limit ?? items.length;
        } while (true);
      }
    }
  }
  return result(exercise, month, latest.data_status ?? null, checkedRows, false, true);
}

function result(exercise: number, month: number | null, deliveryDate: string | null, checkedRows: number, hasNegativeValues: boolean, evaluated: boolean): MscNegativeValuesEvaluation {
  const points = evaluated && !hasNegativeValues ? 1 : 0;
  return { ruleCode: "D1_00017", exercise, month, deliveryDate, checkedRows, hasNegativeValues, points, classification: points ? "total" : "pending" };
}

function normalize(value?: string) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
