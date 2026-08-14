import type { RreoDelivery } from "@/lib/rreo-timeliness";

export type RgfExecutivePeriodEvaluation = {
  period: number;
  deadline: string;
  deliveryDate: string | null;
  status: string | null;
  delivered: boolean;
  timely: boolean;
  deadlineExpired: boolean;
  provisional: boolean;
  points: number;
};

export type RgfExecutiveTimelinessEvaluation = {
  ruleCode: "D1_00003" | "D1_00004";
  exercise: number;
  timelyPeriods: number;
  provisionalPeriods: number;
  failedPeriods: number;
  points: number;
  maximumPoints: 1;
  classification: "total" | "partial" | "pending";
  periods: RgfExecutivePeriodEvaluation[];
};

export function evaluateRgfExecutiveTimeliness(exercise: number, deliveries: RreoDelivery[], today = new Date()): RgfExecutiveTimelinessEvaluation {
  return evaluateRgfTimeliness(exercise, deliveries, "D1_00003", "executive", today);
}

export function evaluateRgfLegislativeTimeliness(exercise: number, deliveries: RreoDelivery[], today = new Date()): RgfExecutiveTimelinessEvaluation {
  return evaluateRgfTimeliness(exercise, deliveries, "D1_00004", "legislative", today);
}

function evaluateRgfTimeliness(exercise: number, deliveries: RreoDelivery[], ruleCode: "D1_00003" | "D1_00004", power: "executive" | "legislative", today: Date): RgfExecutiveTimelinessEvaluation {
  const selectedDeliveries = deliveries.filter((item) => {
    const deliverable = normalize(item.entregavel);
    const institution = normalize(item.instituicao);
    return item.periodicidade === "Q"
      && deliverable.includes("relatorio de gestao fiscal")
      && (power === "executive" ? institution.includes("prefeitura") : institution.includes("camara"));
  });
  const todayKey = today.toISOString().slice(0, 10);
  const periods = Array.from({ length: 3 }, (_, index): RgfExecutivePeriodEvaluation => {
    const period = index + 1;
    const delivery = selectedDeliveries
      .filter((item) => Number(item.periodo) === period)
      .sort((a, b) => String(a.data_status ?? "").localeCompare(String(b.data_status ?? "")))[0];
    const deadline = deadlineFor(exercise, period);
    const status = String(delivery?.status_relatorio ?? "").toUpperCase();
    const delivered = Boolean(delivery?.data_status) && ["HO", "RT", "RE"].includes(status);
    const timely = delivered && String(delivery?.data_status).slice(0, 10) <= deadline;
    const deadlineExpired = todayKey > deadline;
    const provisional = !delivered && !deadlineExpired;
    return { period, deadline, deliveryDate: delivery?.data_status ?? null, status: delivery?.status_relatorio ?? null, delivered, timely, deadlineExpired, provisional, points: timely || provisional ? 1 / 3 : 0 };
  });
  const timelyPeriods = periods.filter((item) => item.timely).length;
  const provisionalPeriods = periods.filter((item) => item.provisional).length;
  const failedPeriods = periods.length - timelyPeriods - provisionalPeriods;
  const points = Number(periods.reduce((sum, item) => sum + item.points, 0).toFixed(4));
  return {
    ruleCode, exercise, timelyPeriods, provisionalPeriods, failedPeriods, points, maximumPoints: 1,
    classification: points === 1 ? "total" : points > 0 ? "partial" : "pending", periods,
  };
}

function deadlineFor(exercise: number, period: number) {
  if (period === 1) return `${exercise}-05-30`;
  if (period === 2) return `${exercise}-09-30`;
  return `${exercise + 1}-01-30`;
}

function normalize(value?: string) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
