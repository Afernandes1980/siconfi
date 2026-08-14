export type RreoDelivery = {
  exercicio?: number;
  periodo?: number;
  periodicidade?: string;
  status_relatorio?: string | null;
  data_status?: string | null;
  entregavel?: string;
  instituicao?: string;
};

export type RreoPeriodEvaluation = {
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

export type RreoTimelinessEvaluation = {
  ruleCode: "D1_00001" | "D1_00006";
  exercise: number;
  lastPeriod: number;
  evaluatedPeriods: number;
  timelyPeriods: number;
  provisionalPeriods: number;
  lateOrMissingPeriods: number;
  points: number;
  maximumPoints: 1;
  classification: "total" | "partial" | "pending";
  periods: RreoPeriodEvaluation[];
};

export function evaluateRreoTimeliness(exercise: number, deliveries: RreoDelivery[], today = new Date(), ruleCode: "D1_00001" | "D1_00006" = "D1_00006"): RreoTimelinessEvaluation {
  const rreo = deliveries.filter((item) => item.periodicidade === "B" && Number(item.periodo) >= 1 && Number(item.periodo) <= 6);
  const lastPeriod = Math.max(0, ...rreo.map((item) => Number(item.periodo)));
  const todayKey = today.toISOString().slice(0, 10);
  const periods = Array.from({ length: 6 }, (_, index): RreoPeriodEvaluation => {
    const period = index + 1;
    const delivery = rreo
      .filter((item) => Number(item.periodo) === period)
      .sort((a, b) => String(a.data_status ?? "").localeCompare(String(b.data_status ?? "")))[0];
    const deadline = deadlineFor(exercise, period);
    const delivered = Boolean(delivery?.data_status) && isAcceptedStatus(delivery?.status_relatorio);
    const timely = delivered && String(delivery?.data_status).slice(0, 10) <= deadline;
    const deadlineExpired = todayKey > deadline;
    const provisional = !delivered && !deadlineExpired;
    return {
      period,
      deadline,
      deliveryDate: delivery?.data_status ?? null,
      status: delivery?.status_relatorio ?? null,
      delivered,
      timely,
      deadlineExpired,
      provisional,
      points: timely || provisional ? 1 / 6 : 0,
    };
  });
  const timelyPeriods = periods.filter((item) => item.timely).length;
  const provisionalPeriods = periods.filter((item) => item.provisional).length;
  const points = Number(periods.reduce((sum, item) => sum + item.points, 0).toFixed(4));
  const classification = points === 1 ? "total" : points > 0 ? "partial" : "pending";
  return {
    ruleCode,
    exercise,
    lastPeriod,
    evaluatedPeriods: 6,
    timelyPeriods,
    provisionalPeriods,
    lateOrMissingPeriods: 6 - timelyPeriods - provisionalPeriods,
    points,
    maximumPoints: 1,
    classification,
    periods,
  };
}

export function evaluateRreoHomologation(exercise: number, deliveries: RreoDelivery[]): RreoTimelinessEvaluation {
  const rreo = deliveries.filter((item) => item.periodicidade === "B" && Number(item.periodo) >= 1 && Number(item.periodo) <= 6);
  const lastPeriod = Math.max(0, ...rreo.map((item) => Number(item.periodo)));
  const periods = Array.from({ length: 6 }, (_, index): RreoPeriodEvaluation => {
    const period = index + 1;
    const delivery = rreo
      .filter((item) => Number(item.periodo) === period)
      .sort((a, b) => String(a.data_status ?? "").localeCompare(String(b.data_status ?? "")))[0];
    const delivered = Boolean(delivery?.data_status) && isAcceptedStatus(delivery?.status_relatorio);
    return {
      period,
      deadline: deadlineFor(exercise, period),
      deliveryDate: delivery?.data_status ?? null,
      status: delivery?.status_relatorio ?? null,
      delivered,
      timely: delivered,
      deadlineExpired: false,
      provisional: false,
      points: delivered ? 1 / 6 : 0,
    };
  });
  const homologatedPeriods = periods.filter((item) => item.delivered).length;
  const points = Number((homologatedPeriods / 6).toFixed(4));
  return {
    ruleCode: "D1_00001", exercise, lastPeriod, evaluatedPeriods: 6, timelyPeriods: homologatedPeriods,
    provisionalPeriods: 0, lateOrMissingPeriods: 6 - homologatedPeriods, points, maximumPoints: 1,
    classification: points === 1 ? "total" : points > 0 ? "partial" : "pending", periods,
  };
}

function deadlineFor(exercise: number, period: number) {
  const closingMonth = period * 2;
  const deadlineMonthIndex = closingMonth;
  const deadline = new Date(Date.UTC(exercise, deadlineMonthIndex + 1, 0));
  return deadline.toISOString().slice(0, 10);
}

function isAcceptedStatus(status?: string | null) {
  const normalized = String(status ?? "").toUpperCase();
  return normalized === "HO" || normalized === "RT" || normalized === "RE";
}
