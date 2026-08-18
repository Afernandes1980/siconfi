import type { RreoDelivery } from "@/lib/rreo-timeliness";

export type MscDeliveryEvaluation = {
  ruleCode: "D1_00016";
  exercise: number;
  deliveredMonths: number;
  missingMonths: number;
  points: number;
  maximumPoints: 1;
  classification: "total" | "partial" | "pending";
  months: Array<{ month: number; deadline: string; delivered: boolean; provisional: boolean; deliveryDate: string | null; institutions: string[]; points: number }>;
};

export function evaluateMscDeliveries(exercise: number, deliveries: RreoDelivery[], today = new Date()): MscDeliveryEvaluation {
  const msc = deliveries.filter((item) => item.periodicidade === "M" && normalize(item.entregavel).includes("msc agregada"));
  const todayKey = today.toISOString().slice(0, 10);
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const entries = msc.filter((item) => Number(item.periodo) === month && Boolean(item.data_status));
    const deliveryDate = entries.map((item) => item.data_status ?? "").filter(Boolean).sort()[0] ?? null;
    const institutions = [...new Set(entries.map((item) => String(item.instituicao ?? "").trim()).filter(Boolean))];
    const delivered = entries.length > 0;
    const deadline = deadlineFor(exercise, month);
    const provisional = !delivered && todayKey <= deadline;
    return { month, deadline, delivered, provisional, deliveryDate, institutions, points: delivered || provisional ? 1 / 12 : 0 };
  });
  const deliveredMonths = months.filter((month) => month.delivered).length;
  const points = Number(months.reduce((sum, month) => sum + month.points, 0).toFixed(4));
  return {
    ruleCode: "D1_00016",
    exercise,
    deliveredMonths,
    missingMonths: 12 - deliveredMonths,
    points,
    maximumPoints: 1,
    classification: points === 1 ? "total" : points > 0 ? "partial" : "pending",
    months,
  };
}

function normalize(value?: string) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function deadlineFor(exercise: number, month: number) {
  const deadline = new Date(Date.UTC(exercise, month + 1, 0));
  return deadline.toISOString().slice(0, 10);
}
