import type { RreoDelivery } from "@/lib/rreo-timeliness";

export type DcaTimelinessEvaluation = {
  ruleCode: "D1_00002" | "D1_00007" | "D1_00012";
  exercise: number;
  deadline: string;
  deliveryDate: string | null;
  status: string | null;
  delivered: boolean;
  timely: boolean;
  deadlineExpired: boolean;
  provisional: boolean;
  points: 0 | 1;
  classification: "total" | "pending";
};

export function evaluateDcaTimeliness(exercise: number, deliveries: RreoDelivery[], today = new Date()): DcaTimelinessEvaluation {
  return evaluateDca(exercise, deliveries, today, "D1_00007");
}

export function evaluateDcaHomologation(exercise: number, deliveries: RreoDelivery[], today = new Date()): DcaTimelinessEvaluation {
  return evaluateDca(exercise, deliveries, today, "D1_00002");
}

export function evaluateDcaWithoutRectification(exercise: number, deliveries: RreoDelivery[], today = new Date()): DcaTimelinessEvaluation {
  const evaluation = evaluateDcaHomologation(exercise, deliveries, today);
  const rectified = String(evaluation.status ?? "").toUpperCase() === "RT";
  return rectified
    ? { ...evaluation, ruleCode: "D1_00012", delivered: false, timely: false, provisional: false, points: 0, classification: "pending" }
    : { ...evaluation, ruleCode: "D1_00012" };
}

function evaluateDca(exercise: number, deliveries: RreoDelivery[], today: Date, ruleCode: "D1_00002" | "D1_00007"): DcaTimelinessEvaluation {
  const dca = deliveries
    .filter((item) => item.periodicidade === "A" && normalize(item.entregavel).includes("balanco anual") && normalize(item.entregavel).includes("dca"))
    .sort((a, b) => String(a.data_status ?? "").localeCompare(String(b.data_status ?? "")))[0];
  const deadline = `${exercise + 1}-04-30`;
  const status = String(dca?.status_relatorio ?? "").toUpperCase();
  const delivered = Boolean(dca?.data_status) && ["HO", "RT", "RE"].includes(status);
  const timely = delivered && String(dca?.data_status).slice(0, 10) <= deadline;
  const todayKey = today.toISOString().slice(0, 10);
  const deadlineExpired = todayKey > deadline;
  const provisional = !delivered && !deadlineExpired;
  const scores = ruleCode === "D1_00002" ? delivered || provisional : timely || provisional;
  return {
    ruleCode,
    exercise,
    deadline,
    deliveryDate: dca?.data_status ?? null,
    status: dca?.status_relatorio ?? null,
    delivered,
    timely,
    deadlineExpired,
    provisional,
    points: scores ? 1 : 0,
    classification: scores ? "total" : "pending",
  };
}

function normalize(value?: string) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
