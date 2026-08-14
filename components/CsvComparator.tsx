"use client";

import { useEffect, useMemo, useState } from "react";
import { type ParsedCsv } from "@/lib/csv";
import { parseSpreadsheet } from "@/lib/spreadsheet";
import { parseCsvOrZip } from "@/lib/zip-csv";
import { extractMscBalances } from "@/lib/msc-balances";
import SiconfiExplorer from "@/components/SiconfiExplorer";
import {
  validateFiscalFile,
  type FiscalValidationIssue,
  type FiscalValidationResult,
} from "@/lib/fiscal-validation";
import {
  compareCsvRows,
  ruleLabel,
  statusLabel,
  summarizeResults,
  type ComparisonRuleKind,
  type FieldMapping,
} from "@/lib/comparison";

const EMPTY_CSV: ParsedCsv = { headers: [], rows: [], delimiter: ";" };
const RULES: ComparisonRuleKind[] = ["equals", "equalsIgnoreCase", "contains", "number", "date"];
const ACCOUNT_CLASS_GROUPS = [
  { label: "Patrimoniais", classes: ["1", "2", "3", "4"] },
  { label: "Orçamentárias", classes: ["5", "6"] },
  { label: "Controle", classes: ["7", "8"] },
] as const;
const QUANTITY_RULE_CODES = new Set(["D1_00011", "D1_00012", "D1_00013", "D1_00014"]);
const DIMENSION_MENUS = [
  { dimension: 1, label: "Dimensão I", total: 44 },
  { dimension: 2, label: "Dimensão II", total: 106 },
  { dimension: 3, label: "Dimensão III", total: 55 },
  { dimension: 4, label: "Dimensão IV", total: 47 },
] as const;
const IMPLEMENTED_RULE_AREAS: Record<string, string> = {
  D1_00019: "validacao-d1-00019",
  D1_00020: "validacao-d1-00020",
  D1_00022: "validacao-d1-00022",
  D1_00023: "validacao-d1-00023",
  D1_00024: "validacao-d1-00024",
  D1_00027: "validacao-d1-00027",
  D1_00028: "validacao-d1-00028",
};

type StoredComparisonRule = {
  id: number;
  dimension: string;
  code: string;
  item: string;
  status: string;
};

type RulesSummary = {
  dimension: string;
  status: string;
  total: number;
};

type ComparisonRuleCheck = {
  ruleCode: string;
  periodIndex: number;
  completedDate: string;
  quantity: number | null;
};

type PeriodicityKey = "monthly" | "bimonthly" | "four_monthly" | "annual" | "not_applicable";
type PeriodicityFilter = PeriodicityKey | "todas";
type RulePeriodicity = { key: PeriodicityKey; label: string; periods: number; periodLabel: string };
type ComparisonRulePeriodicity = { ruleCode: string; periodicity: PeriodicityKey };

type OfficialFiscalDocument = {
  id: string;
  title: string;
  report: "RREO" | "RGF";
  kind: "validation" | "instructions";
  exercise: 2026;
  fileName: string;
  officialPath: string;
};

type OfficialFiscalRule = {
  code: string;
  report: "RREO" | "RGF" | "RREO/RGF";
  category: string;
  severity: "erro" | "aviso";
  description: string;
  sourceDocumentIds: string[];
  packageLabel: string;
};

type PcaspAccount = {
  account: string;
  title: string;
  balanceNature: string;
  normalizedNature: "D" | "C" | "D/C" | "";
};

type PowerBody = {
  code: string;
  name: string;
};

type PowerBodyIssue = {
  rowNumber: number;
  code: string;
};

type PowerBodyValidation = {
  column: string;
  checked: number;
  valid: number;
  issues: PowerBodyIssue[];
};

type RequiredPowerBodyValidation = {
  ic1Column: string;
  type1Column: string;
  checked: number;
  issues: Array<{
    rowNumber: number;
    reference: string;
  }>;
};

type ResourceSource = {
  code: string;
  mainName: string;
};

type ResourceSourceValidation = {
  ic2Column: string;
  type2Column: string;
  checked: number;
  valid: number;
  issues: Array<{
    rowNumber: number;
    reference: string;
    code: string;
    reason: "missing" | "invalid";
  }>;
};

type AccountClassCoverageValidation = {
  accountColumn: string;
  valueColumn: string;
  classes: Array<{
    accountClass: string;
    group: "Patrimonial" | "Orçamentária" | "Controle";
    nonZeroRows: number;
  }>;
  missingClasses: string[];
  passed: boolean;
};

type MscBalanceDifference = {
  comparisonKey: string;
  keyValues: string[];
  previousRowNumber: number | null;
  currentRowNumber: number | null;
  endingValue: number | null;
  beginningValue: number | null;
  endingNature: string;
  beginningNature: string;
  reason: "different_value" | "different_nature" | "missing_ending" | "missing_beginning";
};

type MscExerciseSummary = {
    year: string;
    storedCompetences: string[];
    executivePowerBodies?: Array<{
      code: string;
      name: string;
      competences: string[];
      occurrences: number;
    }>;
    executiveConsistent?: boolean;
    legislativePowerBodies?: Array<{
      code: string;
      name: string;
      competences: string[];
      occurrences: number;
    }>;
    legislativeConsistent?: boolean;
    legislativeDataCompetences?: string[];
    legislativeDuplicateGroups?: Array<{
      competences: string[];
      rows: number;
    }>;
    transitions: Array<{
      previousCompetenceKey: string;
      competenceKey: string;
      status: "compared" | "pending";
      compared: number;
      ignoredZeroBeginning: number;
      differences: number;
    }>;
};

type MscBalanceComparison = {
  competenceKey: string;
  previousCompetenceKey: string;
  compared: number;
  ignoredZeroBeginning: number;
  storedCompetences: string[];
  exercise?: MscExerciseSummary;
  differences: MscBalanceDifference[];
  status: "compared" | "no_previous";
  automaticRuleResults: AutomaticRuleResult[];
};

type AccountNatureIssue = {
  rowNumber: number;
  account: string;
  comparisonKey: string;
  accountClass: string;
  expectedNature: string;
  actualNature: string;
  valueType: string;
  status: "Correto" | "Invertido";
};

type AccountNatureValidation = {
  rows: AccountNatureIssue[];
  checked: number;
  withoutNature: number;
  ignoredType: number;
  ignoredZeroBalance: number;
  inverted: number;
  correct: number;
  columns: {
    account: string;
    value: string;
    valueType: string;
    nature: string;
  };
};

type AccountNatureFilter = "todas" | "corretas" | "invertidas";
type DimensionItemStatus = "total" | "partial" | "pending" | "not_applicable";
type AppUser = { id: number; cpf: string; email: string; displayName: string; role: string; active: number; createdAt: string };
type Organization = { id: number; code: string; name: string; document: string; organizationType: string; state: string; municipality: string; email: string; environment: "demonstration" | "production"; active: number };
type AutomaticRuleResult = { ruleCode: string; passed: boolean };
type RreoTimelinessEvaluation = {
  ruleCode: "D1_00001" | "D1_00006";
  exercise: number;
  lastPeriod: number;
  evaluatedPeriods: number;
  timelyPeriods: number;
  provisionalPeriods: number;
  lateOrMissingPeriods: number;
  points: number;
  maximumPoints: 1;
  classification: DimensionItemStatus;
  periods: Array<{ period: number; deadline: string; deliveryDate: string | null; status: string | null; delivered: boolean; timely: boolean; deadlineExpired: boolean; provisional: boolean; points: number }>;
};
type DcaTimelinessEvaluation = {
  ruleCode: "D1_00002";
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
type RgfExecutiveTimelinessEvaluation = {
  ruleCode: "D1_00003" | "D1_00004";
  exercise: number;
  timelyPeriods: number;
  provisionalPeriods: number;
  failedPeriods: number;
  points: number;
  maximumPoints: 1;
  classification: "total" | "partial" | "pending";
  periods: Array<{ period: number; deadline: string; deliveryDate: string | null; status: string | null; delivered: boolean; timely: boolean; deadlineExpired: boolean; provisional: boolean; points: number }>;
};

export default function CsvComparator({
  currentUser,
}: {
  currentUser: { id: number; cpf: string; displayName: string; email: string; role: string; organizationId: number | null; organizationName: string | null; organizationCode: string | null };
}) {
  const [sourceCsv, setSourceCsv] = useState<ParsedCsv>(EMPTY_CSV);
  const [targetCsv, setTargetCsv] = useState<ParsedCsv>(EMPTY_CSV);
  const [sourceName, setSourceName] = useState("");
  const [targetName, setTargetName] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [storedRules, setStoredRules] = useState<StoredComparisonRule[]>([]);
  const [rulesSummary, setRulesSummary] = useState<RulesSummary[]>([]);
  const [ruleChecks, setRuleChecks] = useState<ComparisonRuleCheck[]>([]);
  const [rulePeriodicities, setRulePeriodicities] = useState<ComparisonRulePeriodicity[]>([]);
  const [editingRule, setEditingRule] = useState<StoredComparisonRule | null>(null);
  const [editingPeriodicity, setEditingPeriodicity] = useState<PeriodicityKey>("annual");
  const [editingDates, setEditingDates] = useState<string[]>([]);
  const [editingQuantities, setEditingQuantities] = useState<string[]>([]);
  const [savingChecks, setSavingChecks] = useState(false);
  const [checksError, setChecksError] = useState("");
  const [rulesLoading, setRulesLoading] = useState(true);
  const [fileError, setFileError] = useState("");
  const [rulesSearch, setRulesSearch] = useState("");
  const [selectedPeriodicityFilter, setSelectedPeriodicityFilter] = useState<PeriodicityFilter>("todas");
  const [showAccountNature, setShowAccountNature] = useState(true);
  const [accountNatureFilter, setAccountNatureFilter] = useState<AccountNatureFilter>("todas");
  const [officialFiscalDocuments, setOfficialFiscalDocuments] = useState<OfficialFiscalDocument[]>([]);
  const [officialFiscalRules, setOfficialFiscalRules] = useState<OfficialFiscalRule[]>([]);
  const [pcaspAccounts, setPcaspAccounts] = useState<PcaspAccount[]>([]);
  const [powerBodies, setPowerBodies] = useState<PowerBody[]>([]);
  const [resourceSources, setResourceSources] = useState<ResourceSource[]>([]);
  const [balanceComparison, setBalanceComparison] = useState<MscBalanceComparison | null>(null);
  const [balanceExercise, setBalanceExercise] = useState<MscExerciseSummary | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [automaticRuleResults, setAutomaticRuleResults] = useState<AutomaticRuleResult[]>([]);
  const [rreoTimeliness, setRreoTimeliness] = useState<RreoTimelinessEvaluation | null>(null);
  const [rreoHomologation, setRreoHomologation] = useState<RreoTimelinessEvaluation | null>(null);
  const [dcaTimeliness, setDcaTimeliness] = useState<DcaTimelinessEvaluation | null>(null);
  const [rgfExecutiveTimeliness, setRgfExecutiveTimeliness] = useState<RgfExecutiveTimelinessEvaluation | null>(null);
  const [rgfLegislativeTimeliness, setRgfLegislativeTimeliness] = useState<RgfExecutiveTimelinessEvaluation | null>(null);
  const [activeRegistration, setActiveRegistration] = useState<"users" | "organizations" | null>(null);
  const [activeArea, setActiveArea] = useState<string | null>(null);
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");

  const canCompare = sourceCsv.rows.length > 0 && targetCsv.rows.length > 0 && sourceKey && targetKey;

  const results = useMemo(() => {
    if (!canCompare) return [];
    return compareCsvRows(sourceCsv.rows, targetCsv.rows, { sourceKey, targetKey, mappings });
  }, [canCompare, mappings, sourceCsv.rows, sourceKey, targetCsv.rows, targetKey]);

  const summary = useMemo(() => summarizeResults(results), [results]);
  const previewResults = results.slice(0, 60);
  const selectedPendingRule = activeArea?.startsWith("regra-") ? activeArea.slice(6) : null;
  const selectedPendingRuleDetails = selectedPendingRule
    ? storedRules.find((rule) => rule.code === selectedPendingRule)
    : null;

  const ruleDimensions = useMemo(
    () => [...new Set(rulesSummary.map((item) => item.dimension))],
    [rulesSummary],
  );
  const periodicityByRule = useMemo(
    () => new Map(rulePeriodicities.map((item) => [item.ruleCode, item.periodicity])),
    [rulePeriodicities],
  );
  const visibleRules = useMemo(() => {
    const search = normalizeSearch(rulesSearch);

    return storedRules.filter((rule) => {
      const rulePeriodicity = periodicityByRule.get(rule.code) ?? inferRulePeriodicity(rule.item);
      const matchesPeriodicity = selectedPeriodicityFilter === "todas"
        || rulePeriodicity === selectedPeriodicityFilter;
      const searchable = normalizeSearch(`${rule.dimension} ${rule.code} ${rule.item} ${rule.status} ${getRulePeriodicity(rulePeriodicity).label}`);
      return matchesPeriodicity && (!search || searchable.includes(search));
    });
  }, [periodicityByRule, rulesSearch, selectedPeriodicityFilter, storedRules]);
  const checksByRule = useMemo(() => {
    const checks = new Map<string, Map<number, ComparisonRuleCheck>>();
    ruleChecks.forEach((check) => {
      const periods = checks.get(check.ruleCode) ?? new Map<number, ComparisonRuleCheck>();
      periods.set(Number(check.periodIndex), check);
      checks.set(check.ruleCode, periods);
    });
    return checks;
  }, [ruleChecks]);
  const accountNatureValidation = useMemo(
    () => validateAccountNatures(sourceCsv, pcaspAccounts),
    [pcaspAccounts, sourceCsv],
  );
  const powerBodyValidation = useMemo(
    () => validatePowerBodies(sourceCsv, powerBodies),
    [powerBodies, sourceCsv],
  );
  const requiredPowerBodyValidation = useMemo(
    () => validateRequiredPowerBodies(sourceCsv),
    [sourceCsv],
  );
  const resourceSourceValidation = useMemo(
    () => validateResourceSources(sourceCsv, resourceSources),
    [resourceSources, sourceCsv],
  );
  const accountClassCoverageValidation = useMemo(
    () => validateAccountClassCoverage(sourceCsv),
    [sourceCsv],
  );
  const fiscalValidation = useMemo(
    () => validateFiscalFile(targetCsv, targetName),
    [targetCsv, targetName],
  );
  const accountNatureRows = accountNatureValidation.rows;
  const automaticResultsByRule = useMemo(
    () => new Map(automaticRuleResults.map((result) => [result.ruleCode, result.passed])),
    [automaticRuleResults],
  );

  useEffect(() => {
    if (!currentUser.organizationCode) return;
    fetch("/api/ranking", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar as avaliações automáticas.");
        return data as {
          d1_00001: RreoTimelinessEvaluation;
          d1_00002: DcaTimelinessEvaluation;
          d1_00003: RgfExecutiveTimelinessEvaluation;
          d1_00004: RgfExecutiveTimelinessEvaluation;
          d1_00006: RreoTimelinessEvaluation;
        };
      })
      .then((data) => {
        setRreoHomologation(data.d1_00001);
        setDcaTimeliness(data.d1_00002);
        setRgfExecutiveTimeliness(data.d1_00003);
        setRgfLegislativeTimeliness(data.d1_00004);
        setRreoTimeliness(data.d1_00006);
      })
      .catch((error) => console.error(error));
  }, [currentUser.organizationCode]);
  const accountNatureIssues = accountNatureRows.filter((row) => row.status === "Invertido");
  const filteredAccountNatureRows = useMemo(() => {
    if (accountNatureFilter === "corretas") {
      return accountNatureRows.filter((row) => row.status === "Correto");
    }

    if (accountNatureFilter === "invertidas") {
      return accountNatureIssues;
    }

    return accountNatureRows;
  }, [accountNatureFilter, accountNatureIssues, accountNatureRows]);

  useEffect(() => {
    let active = true;

    fetch("/api/comparison-rules", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: {
        rules: StoredComparisonRule[];
        summary: RulesSummary[];
        checks: ComparisonRuleCheck[];
        periodicities: ComparisonRulePeriodicity[];
        officialFiscal?: {
          documents: OfficialFiscalDocument[];
          rules: OfficialFiscalRule[];
        };
      }) => {
        if (!active) return;
        setStoredRules(data.rules ?? []);
        setRulesSummary(data.summary ?? []);
        setRuleChecks(data.checks ?? []);
        setRulePeriodicities(data.periodicities ?? []);
        setOfficialFiscalDocuments(data.officialFiscal?.documents ?? []);
        setOfficialFiscalRules(data.officialFiscal?.rules ?? []);
      })
      .catch(() => {
        if (!active) return;
        setStoredRules([]);
        setRulesSummary([]);
        setRuleChecks([]);
        setRulePeriodicities([]);
        setOfficialFiscalDocuments([]);
        setOfficialFiscalRules([]);
      })
      .finally(() => {
        if (active) setRulesLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    fetch("/api/resource-sources", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { resourceSources: ResourceSource[] }) => {
        if (active) setResourceSources(data.resourceSources ?? []);
      })
      .catch(() => {
        if (active) setResourceSources([]);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/msc-balances", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { exercise?: MscExerciseSummary | null; automaticRuleResults?: AutomaticRuleResult[] }) => {
        if (active) {
          setBalanceExercise(data.exercise ?? null);
          setAutomaticRuleResults(data.automaticRuleResults ?? []);
        }
      })
      .catch(() => {
        if (active) setBalanceExercise(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    fetch("/api/power-bodies", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { powerBodies: PowerBody[] }) => {
        if (active) setPowerBodies(data.powerBodies ?? []);
      })
      .catch(() => {
        if (active) setPowerBodies([]);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    fetch("/api/pcasp-accounts", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { accounts: PcaspAccount[] }) => {
        if (active) setPcaspAccounts(data.accounts ?? []);
      })
      .catch(() => {
        if (active) setPcaspAccounts([]);
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleFile(file: File, side: "source" | "target") {
    setFileError("");
    const imported = side === "target"
      ? { parsed: await parseSpreadsheet(file), importedName: file.name }
      : await parseCsvOrZip(file, { hasHeader: true, headerRowIndex: 1, dataStartRowIndex: 2 });

    if (side === "source") {
      setSourceCsv(imported.parsed);
      setSourceName(imported.importedName);
      setSourceKey(imported.parsed.headers[0] ?? "");
      setMappings((current) => current.filter((mapping) => imported.parsed.headers.includes(mapping.sourceColumn)));
      await saveMscBalanceHistory(imported.parsed, imported.importedName);
      return;
    }

    setTargetCsv(imported.parsed);
    setTargetName(file.name);
    setTargetKey(imported.parsed.headers[0] ?? "");
    setMappings((current) => current.filter((mapping) => imported.parsed.headers.includes(mapping.targetColumn)));
  }

  async function saveMscBalanceHistory(csv: ParsedCsv, importedName: string) {
    const payload = extractMscBalances(csv);
    const accountNature = validateAccountNatures(csv, pcaspAccounts);
    const powerBody = validatePowerBodies(csv, powerBodies);
    const requiredPowerBody = validateRequiredPowerBodies(csv);
    const resourceSource = validateResourceSources(csv, resourceSources);
    const classCoverage = validateAccountClassCoverage(csv);
    const automaticRuleResults = [
      ...(powerBody.column && powerBodies.length > 0 ? [{ ruleCode: "D1_00019", passed: powerBody.checked > 0 && powerBody.issues.length === 0 }] : []),
      ...(accountNature.columns.account && pcaspAccounts.length > 0 ? [{ ruleCode: "D1_00021", passed: accountNature.checked > 0 && accountNature.inverted === 0 && accountNature.withoutNature === 0 }] : []),
      ...(requiredPowerBody.ic1Column && requiredPowerBody.type1Column ? [{ ruleCode: "D1_00022", passed: requiredPowerBody.issues.length === 0 }] : []),
      ...(resourceSource.ic2Column && resourceSource.type2Column && resourceSources.length > 0 ? [{ ruleCode: "D1_00027", passed: resourceSource.issues.length === 0 }] : []),
      ...(classCoverage.accountColumn && classCoverage.valueColumn ? [{ ruleCode: "D1_00028", passed: classCoverage.passed }] : []),
    ];
    setBalanceComparison(null);
    setBalanceError("");

    if (!payload.competenceKey) {
      setBalanceError("Nao foi possivel identificar a competencia na celula B1 da MSC.");
      return;
    }
    if (payload.rows.length === 0) {
      setBalanceError("Nao foram encontrados saldos beginning_balance ou ending_balance nas tres ultimas colunas.");
      return;
    }

    setBalanceLoading(true);
    try {
      const response = await fetch("/api/msc-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, sourceFile: importedName, automaticRuleResults }),
      });
      const data = await response.json() as MscBalanceComparison & { error?: string };
      if (!response.ok) throw new Error(data.error || "Nao foi possivel gravar os saldos da MSC.");
      setBalanceComparison(data);
      setBalanceExercise(data.exercise ?? null);
      setAutomaticRuleResults(data.automaticRuleResults ?? []);
    } catch (error) {
      setBalanceError(error instanceof Error ? error.message : "Nao foi possivel gravar os saldos da MSC.");
    } finally {
      setBalanceLoading(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  async function openRegistration(section: "users" | "organizations") {
    setActiveRegistration(section);
    await loadRegistrations();
  }

  async function loadRegistrations() {
    setUsersLoading(true);
    setUsersError("");
    try {
      const [usersResponse, organizationsResponse] = await Promise.all([
        fetch("/api/users", { cache: "no-store" }),
        fetch("/api/organizations", { cache: "no-store" }),
      ]);
      const usersData = await usersResponse.json();
      const organizationsData = await organizationsResponse.json();
      if (!usersResponse.ok) throw new Error(usersData.error ?? "Não foi possível carregar os usuários.");
      if (!organizationsResponse.ok) throw new Error(organizationsData.error ?? "Não foi possível carregar as empresas.");
      setAppUsers(usersData.users ?? []);
      setOrganizations(organizationsData.organizations ?? []);
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : "Não foi possível carregar os usuários.");
    } finally {
      setUsersLoading(false);
    }
  }

  async function saveOrganization(input: Omit<Organization, "id"> & { id?: number }) {
    const response = await fetch("/api/organizations", { method: input.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar a empresa.");
    await loadRegistrations();
  }

  async function saveAppUser(input: { id?: number; displayName: string; cpf: string; email: string; password: string; active: boolean }) {
    setUsersError("");
    const response = await fetch("/api/users", {
      method: input.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Não foi possível salvar o usuário.");
    await loadRegistrations();
  }

  function openRuleChecks(rule: StoredComparisonRule, selected?: PeriodicityKey) {
    const periodicity = getRulePeriodicity(selected ?? periodicityByRule.get(rule.code) ?? inferRulePeriodicity(rule.item));
    const savedDates = checksByRule.get(rule.code);
    setEditingRule(rule);
    setEditingPeriodicity(periodicity.key);
    setEditingDates(Array.from({ length: periodicity.periods }, (_, index) => savedDates?.get(index + 1)?.completedDate ?? ""));
    setEditingQuantities(Array.from({ length: periodicity.periods }, (_, index) => {
      const quantity = savedDates?.get(index + 1)?.quantity;
      return quantity === null || quantity === undefined ? "" : String(quantity);
    }));
    setChecksError("");
  }

  async function saveRuleChecks() {
    if (!editingRule) return;
    setSavingChecks(true);
    setChecksError("");
    try {
      const response = await fetch("/api/comparison-rules/checks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleCode: editingRule.code, periodicity: editingPeriodicity, dates: editingDates, quantities: editingQuantities }),
      });
      if (!response.ok) throw new Error("Nao foi possivel salvar as datas.");
      setRuleChecks((current) => [
        ...current.filter((check) => check.ruleCode !== editingRule.code),
        ...editingDates.flatMap((completedDate, index) => completedDate || editingQuantities[index]
          ? [{ ruleCode: editingRule.code, periodIndex: index + 1, completedDate, quantity: editingQuantities[index] === "" ? null : Number(editingQuantities[index]) }]
          : []),
      ]);
      setRulePeriodicities((current) => [
        ...current.filter((item) => item.ruleCode !== editingRule.code),
        { ruleCode: editingRule.code, periodicity: editingPeriodicity },
      ]);
      setEditingRule(null);
    } catch (error) {
      setChecksError(error instanceof Error ? error.message : "Nao foi possivel salvar as datas.");
    } finally {
      setSavingChecks(false);
    }
  }

  async function handleFileSafely(file: File, side: "source" | "target") {
    try {
      await handleFile(file, side);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Nao foi possivel importar o arquivo.");
    }
  }

  function addMapping() {
    const sourceColumn = sourceCsv.headers.find((header) => header !== sourceKey) ?? sourceCsv.headers[0] ?? "";
    const targetColumn = targetCsv.headers.find((header) => header !== targetKey) ?? targetCsv.headers[0] ?? "";

    if (!sourceColumn || !targetColumn) return;

    setMappings((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        sourceColumn,
        targetColumn,
        rule: "equals",
        tolerance: 0,
      },
    ]);
  }

  function updateMapping(id: string, patch: Partial<FieldMapping>) {
    setMappings((current) =>
      current.map((mapping) => (mapping.id === id ? { ...mapping, ...patch } : mapping)),
    );
  }

  function removeMapping(id: string) {
    setMappings((current) => current.filter((mapping) => mapping.id !== id));
  }

  return (
    <main className="app-background">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col lg:min-h-screen lg:flex-row">
        <aside className="border-b border-slate-950/70 bg-gradient-to-b from-cyan-900 via-blue-950 to-slate-950 text-white shadow-xl shadow-blue-950/30 lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:h-screen lg:w-72">
          <div className="flex h-full flex-col p-4 lg:p-6">
            <div className="flex items-center justify-between gap-4 lg:block">
              <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-100">Siconfi</p><p className="mt-1 text-lg font-semibold">Ranking Municipal</p></div>
              <div className="text-right lg:mt-6 lg:text-left"><p className="text-sm font-semibold">{currentUser.displayName}</p><p className="text-xs text-blue-100/80">{currentUser.organizationName}</p></div>
            </div>
            <nav aria-label="Menu principal" className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:mt-8 lg:flex-col lg:overflow-y-auto">
              <button type="button" onClick={() => setActiveArea((current) => current === "arquivos" ? null : "arquivos")} className={`sidebar-link text-left ${activeArea === "arquivos" ? "bg-white/20 text-white shadow-sm ring-1 ring-white/25" : ""}`} aria-expanded={activeArea === "arquivos"}>Área de importação</button>
              <button type="button" onClick={() => setActiveArea((current) => current === "siconfi-api" ? null : "siconfi-api")} className={`sidebar-link text-left ${activeArea === "siconfi-api" ? "bg-white/20 text-white shadow-sm ring-1 ring-white/25" : ""}`} aria-expanded={activeArea === "siconfi-api"}>Central de dados Siconfi</button>
              {DIMENSION_MENUS.map(({ dimension, label, total }) => {
                const isActive = activeArea === `dashboard-dimension-${dimension}`;
                return (
                  <div key={dimension} className="shrink-0">
                    <button type="button" className={`sidebar-dimension ${isActive ? "bg-white/20 ring-1 ring-white/25" : ""}`} onClick={() => setActiveArea(`dashboard-dimension-${dimension}`)} aria-current={isActive ? "page" : undefined}>
                      <span>{label}</span><span className="text-xs text-blue-100/75">{total} itens</span>
                    </button>
                  </div>
                );
              })}
            </nav>
            <div className="mt-4 flex flex-wrap gap-2 border-t border-white/20 pt-4 lg:mt-auto lg:flex-col">
              {currentUser.role === "admin" && <><button type="button" className="sidebar-action" onClick={() => openRegistration("users")}>Cadastro de usuários</button><button type="button" className="sidebar-action" onClick={() => openRegistration("organizations")}>Cadastro de empresas</button></>}
              <button type="button" className="sidebar-action" onClick={() => window.location.assign("/empresas")}>Trocar empresa</button>
              <button type="button" className="sidebar-action text-rose-200" onClick={handleLogout}>Sair</button>
            </div>
          </div>
        </aside>
      <section className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:ml-72 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
          <div>
            <p className="text-xs font-semibold uppercase text-cyan-700">Siconfi</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Análise do Ranking Municipal - STN
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Configure a chave que liga os arquivos, escolha os campos comparados e aplique regras
              por mapeamento.
            </p>
          </div>

          <div className="hidden">
            <div className="text-right">
              <p className="text-sm font-semibold text-slate-800">{currentUser.displayName}</p>
              <p className="text-xs text-slate-500">{currentUser.organizationName}</p>
            </div>
            <button type="button" className="form-button-secondary" onClick={handleLogout}>
              Sair
            </button>
            {currentUser.role === "admin" && (
              <details className="group relative">
                <summary className="form-button-secondary cursor-pointer list-none select-none">
                  Utilitários <span className="ml-2 text-xs transition group-open:rotate-180">⌄</span>
                </summary>
                <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
                  <button type="button" className="block w-full rounded-md px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950" onClick={() => openRegistration("users")}>Cadastro de usuários</button>
                  <button type="button" className="block w-full rounded-md px-3 py-2.5 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950" onClick={() => openRegistration("organizations")}>Cadastro de empresas</button>
                </div>
              </details>
            )}
            <button type="button" className="form-button-secondary" onClick={() => window.location.assign("/empresas")}>
              Trocar empresa
            </button>
          </div>
        </header>

        {activeRegistration === "users" && (
          <UsersDialog
            currentUserId={currentUser.id}
            users={appUsers}
            loading={usersLoading}
            error={usersError}
            onClose={() => setActiveRegistration(null)}
            onSave={saveAppUser}
          />
        )}
        {activeRegistration === "organizations" && (
          <OrganizationsDialog organizations={organizations} error={usersError} onClose={() => setActiveRegistration(null)} onSave={saveOrganization} />
        )}

        {activeArea === null && (
          <div className="flex min-h-[calc(100vh-180px)] items-center justify-center px-6 py-16" aria-hidden="true">
            <img
              src="/fortec-watermark.png"
              alt=""
              className="h-auto w-full max-w-[460px] select-none object-contain opacity-20"
              draggable={false}
            />
          </div>
        )}

        {DIMENSION_MENUS.map(({ dimension, label }) => activeArea === `dashboard-dimension-${dimension}` && (
          <DimensionDashboard
            key={dimension}
            dimension={dimension}
            label={label}
            rules={storedRules.filter((rule) => rule.code.startsWith(`D${dimension}_`))}
            checksByRule={checksByRule}
            periodicityByRule={periodicityByRule}
            loading={rulesLoading}
            automaticRuleCompleted={dimension === 1 && sourceCsv.rows.length > 0 && pcaspAccounts.length > 0 && accountNatureValidation.checked > 0 && accountNatureValidation.inverted === 0 && accountNatureValidation.withoutNature === 0}
            automaticResultsByRule={automaticResultsByRule}
            rreoTimeliness={rreoTimeliness}
            rreoHomologation={rreoHomologation}
            dcaTimeliness={dcaTimeliness}
            rgfExecutiveTimeliness={rgfExecutiveTimeliness}
            rgfLegislativeTimeliness={rgfLegislativeTimeliness}
            onSelectRule={(code) => setActiveArea(IMPLEMENTED_RULE_AREAS[code] ?? `regra-${code}`)}
          />
        ))}

        {selectedPendingRule && (
          <section className="panel mt-6 p-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Regra do Ranking Municipal</p>
            <h2 className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xl font-semibold text-slate-950">
              <span>{selectedPendingRule}</span>
              {selectedPendingRuleDetails?.item && (
                <span className="text-lg font-medium text-slate-600">— {selectedPendingRuleDetails.item}</span>
              )}
            </h2>
            <p className="mt-3 text-sm text-slate-600">Área individual reservada para a implementação e apresentação desta regra.</p>
            {selectedPendingRule === "D1_00001" && rreoHomologation && (
              <RreoHomologationDetails evaluation={rreoHomologation} />
            )}
            {selectedPendingRule === "D1_00002" && dcaTimeliness && (
              <DcaTimelinessDetails evaluation={dcaTimeliness} />
            )}
            {selectedPendingRule === "D1_00003" && rgfExecutiveTimeliness && (
              <RgfExecutiveTimelinessDetails evaluation={rgfExecutiveTimeliness} />
            )}
            {selectedPendingRule === "D1_00004" && rgfLegislativeTimeliness && (
              <RgfExecutiveTimelinessDetails evaluation={rgfLegislativeTimeliness} />
            )}
            {selectedPendingRule === "D1_00006" && rreoTimeliness && (
              <RreoTimelinessDetails evaluation={rreoTimeliness} />
            )}
          </section>
        )}

        {activeArea === "siconfi-api" && (
          <SiconfiExplorer rules={storedRules} organizationCode={currentUser.organizationCode ?? ""} />
        )}

        <div id="arquivos" className={`${activeArea === "arquivos" ? "grid" : "hidden"} mt-6 scroll-mt-5 gap-4 xl:grid-cols-2`}>
          <FilePanel
            title="MATRIZ"
            fileKind="csv"
            fileName={sourceName}
            parsedCsv={sourceCsv}
            selectedKey={sourceKey}
            onFile={(file) => handleFileSafely(file, "source")}
            onKeyChange={setSourceKey}
          />
          <FilePanel
            title="FISCAL"
            fileKind="xls"
            fileName={targetName}
            parsedCsv={targetCsv}
            selectedKey={targetKey}
            onFile={(file) => handleFileSafely(file, "target")}
            onKeyChange={setTargetKey}
          />
        </div>

        {activeArea === "arquivos" && balanceLoading && (
          <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-medium text-cyan-900">
            Gravando a MSC no ambiente de {currentUser.organizationName ?? "empresa selecionada"}...
          </div>
        )}

        {activeArea === "arquivos" && balanceComparison && !balanceLoading && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
            MSC {balanceComparison.competenceKey} importada com sucesso para {currentUser.organizationName ?? "a empresa selecionada"}.
          </div>
        )}

        {activeArea === "arquivos" && balanceError && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            {balanceError}
          </div>
        )}

        {activeArea === "arquivos" && fileError && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
            {fileError}
          </div>
        )}

        <a
          href="#validacao-d1-00019"
          className="hidden"
        >
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wide text-pink-700">
              Validacao da MSC
            </span>
            <span className="mt-1 block font-semibold">Ver resultado da regra D1_00019 — coluna B (IC1)</span>
          </span>
          <span className="shrink-0 text-2xl" aria-hidden="true">↓</span>
        </a>

        <a
          href="#validacao-d1-00020"
          className="hidden"
        >
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wide text-pink-700">
              Historico de saldos da MSC
            </span>
            <span className="mt-1 block font-semibold">Ver resultado da regra D1_00020 — continuidade entre competencias</span>
          </span>
          <span className="shrink-0 text-2xl" aria-hidden="true">↓</span>
        </a>

        <a
          href="#validacao-d1-00022"
          className="hidden"
        >
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wide text-pink-700">
              Preenchimento obrigatorio da MSC
            </span>
            <span className="mt-1 block font-semibold">Ver resultado da regra D1_00022 — TIPO1 PO exige IC1</span>
          </span>
          <span className="shrink-0 text-2xl" aria-hidden="true">↓</span>
        </a>

        <a
          href="#validacao-d1-00023"
          className="hidden"
        >
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wide text-pink-700">
              Consistencia anual da MSC
            </span>
            <span className="mt-1 block font-semibold">Ver resultado da regra D1_00023 — Poder Executivo entre competencias</span>
          </span>
          <span className="shrink-0 text-2xl" aria-hidden="true">↓</span>
        </a>

        <a
          href="#validacao-d1-00024"
          className="hidden"
        >
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wide text-pink-700">
              Consistencia anual da MSC
            </span>
            <span className="mt-1 block font-semibold">Ver resultado da regra D1_00024 — dados legislativos iguais entre meses</span>
          </span>
          <span className="shrink-0 text-2xl" aria-hidden="true">↓</span>
        </a>

        <a
          href="#validacao-d1-00027"
          className="hidden"
        >
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wide text-pink-700">
              Fonte de recursos da MSC
            </span>
            <span className="mt-1 block font-semibold">Ver resultado da regra D1_00027 — TIPO2 FR exige fonte válida em IC2</span>
          </span>
          <span className="shrink-0 text-2xl" aria-hidden="true">↓</span>
        </a>

        <a
          href="#validacao-d1-00028"
          className="hidden"
        >
          <span>
            <span className="block text-xs font-semibold uppercase tracking-wide text-pink-700">
              Cobertura das classes contábeis
            </span>
            <span className="mt-1 block font-semibold">Ver resultado da regra D1_00028 — valores diferentes de zero nas classes 1 a 8</span>
          </span>
          <span className="shrink-0 text-2xl" aria-hidden="true">↓</span>
        </a>

        <div className={activeArea === "regras-fiscais" ? "block" : "hidden"}><FiscalRulesPanel
          validation={fiscalValidation}
          documents={officialFiscalDocuments}
          rules={officialFiscalRules}
          hasFiscalFile={targetCsv.rows.length > 0 || targetCsv.headers.length > 0}
        /></div>

        <section id="validacao-d1-00019" className={`${activeArea === "validacao-d1-00019" ? "block" : "hidden"} panel mt-5 scroll-mt-5 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-pink-700">D1 · D1_00019</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">Poder e Orgao (IC1)</h2>
              <p className="mt-1 text-sm text-slate-500">
                Confere os codigos da coluna B, identificada como IC1, com a tabela oficial power_bodies_2026.
              </p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-right">
              <p className="text-xs font-semibold uppercase text-rose-700">Codigos invalidos</p>
              <p className="mt-1 text-2xl font-semibold text-rose-950">{powerBodyValidation.issues.length}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <DataPoint label="Coluna analisada" value={powerBodyValidation.column ? 1 : 0} />
            <DataPoint label="Codigos conferidos" value={powerBodyValidation.checked} />
            <DataPoint label="Codigos validos" value={powerBodyValidation.valid} />
          </div>

          {sourceCsv.rows.length > 0 && !powerBodyValidation.column && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              A coluna B nao foi identificada como IC1. A regra D1_00019 nao pode ser conferida.
            </div>
          )}

          {powerBodyValidation.column && powerBodyValidation.issues.length > 0 && (
            <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-rose-200">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="sticky top-0 bg-rose-50 text-xs uppercase text-rose-700">
                  <tr>
                    <th className="w-28 px-4 py-3">Linha</th>
                    <th className="w-40 px-4 py-3">Coluna</th>
                    <th className="px-4 py-3">Codigo nao encontrado</th>
                    <th className="px-4 py-3">Regra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rose-100">
                  {powerBodyValidation.issues.map((issue) => (
                    <tr key={`${issue.rowNumber}-${issue.code}`} className="bg-rose-50/50 text-rose-800">
                      <td className="px-4 py-3 font-semibold">{issue.rowNumber}</td>
                      <td className="px-4 py-3 font-semibold">B (IC1)</td>
                      <td className="break-words px-4 py-3 font-bold">{issue.code}</td>
                      <td className="px-4 py-3 font-semibold">D1_00019</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section id="validacao-d1-00022" className={`${activeArea === "validacao-d1-00022" ? "block" : "hidden"} panel mt-5 scroll-mt-5 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-pink-700">D1 · D1_00022</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">Poder e Orgao obrigatorio</h2>
              <p className="mt-1 text-sm text-slate-500">
                Verifica se todas as linhas com TIPO1 igual a PO possuem o codigo do Poder e Orgao preenchido em IC1.
              </p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-right">
              <p className="text-xs font-semibold uppercase text-rose-700">IC1 nao informado</p>
              <p className="mt-1 text-2xl font-semibold text-rose-950">{requiredPowerBodyValidation.issues.length}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <DataPoint label="Linhas TIPO1 = PO" value={requiredPowerBodyValidation.checked} />
            <DataPoint label="Linhas preenchidas" value={requiredPowerBodyValidation.checked - requiredPowerBodyValidation.issues.length} />
            <DataPoint label="Linhas sem IC1" value={requiredPowerBodyValidation.issues.length} />
          </div>

          {sourceCsv.rows.length > 0 && (!requiredPowerBodyValidation.ic1Column || !requiredPowerBodyValidation.type1Column) && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Nao foi possivel identificar as colunas IC1 e TIPO1 na MSC. A regra D1_00022 nao pode ser conferida.
            </div>
          )}

          {requiredPowerBodyValidation.ic1Column && requiredPowerBodyValidation.type1Column && requiredPowerBodyValidation.issues.length === 0 && sourceCsv.rows.length > 0 && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              Todas as linhas com TIPO1 igual a PO possuem Poder e Orgao informado em IC1.
            </div>
          )}

          {requiredPowerBodyValidation.issues.length > 0 && (
            <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-rose-200">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="sticky top-0 bg-rose-50 text-xs uppercase text-rose-700">
                  <tr>
                    <th className="w-28 px-4 py-3">Linha</th>
                    <th className="px-4 py-3">Conta ou referencia</th>
                    <th className="w-32 px-4 py-3">TIPO1</th>
                    <th className="w-32 px-4 py-3">IC1</th>
                    <th className="w-40 px-4 py-3">Regra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rose-100">
                  {requiredPowerBodyValidation.issues.map((issue) => (
                    <tr key={`${issue.rowNumber}-${issue.reference}`} className="bg-rose-50/40 text-rose-900">
                      <td className="px-4 py-3 font-semibold">{issue.rowNumber}</td>
                      <td className="break-words px-4 py-3 font-semibold">{issue.reference || "-"}</td>
                      <td className="px-4 py-3 font-bold">PO</td>
                      <td className="px-4 py-3 font-bold">Nao informado</td>
                      <td className="px-4 py-3 font-semibold">D1_00022</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section id="validacao-d1-00023" className={`${activeArea === "validacao-d1-00023" ? "block" : "hidden"} panel mt-5 scroll-mt-5 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-pink-700">D1 · D1_00023</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">Poder Executivo entre competencias</h2>
              <p className="mt-1 max-w-4xl text-sm text-slate-500">
                Confere em todas as MSC armazenadas do exercicio se foi utilizado mais de um codigo classificado como Poder Executivo na tabela power_bodies_2026.
              </p>
            </div>
            <div className={`rounded-lg border px-4 py-3 text-right ${
              balanceExercise && !isExecutivePowerConsistent(balanceExercise)
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}>
              <p className="text-xs font-semibold uppercase opacity-70">Codigos executivos</p>
              <p className="mt-1 text-2xl font-semibold">{balanceExercise?.executivePowerBodies?.length ?? 0}</p>
            </div>
          </div>

          {!balanceExercise && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Importe as MSC do exercicio para iniciar a verificacao D1_00023.
            </div>
          )}

          {balanceExercise && (balanceExercise.executivePowerBodies?.length ?? 0) === 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Nenhum codigo com descricao de Poder Executivo foi encontrado nas competencias armazenadas. Reimporte as MSC para registrar os codigos de IC1.
            </div>
          )}

          {balanceExercise && (balanceExercise.executivePowerBodies?.length ?? 0) > 0 && isExecutivePowerConsistent(balanceExercise) && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              Os codigos de Poder Executivo utilizados nas competencias do exercicio {balanceExercise.year} sao consistentes. A combinacao municipal 10131 (Prefeitura e Fundos) com 10132 (RPPS) e permitida.
            </div>
          )}

          {balanceExercise && !isExecutivePowerConsistent(balanceExercise) && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
              Possivel inconsistencia: foram encontrados codigos diferentes de Poder Executivo no mesmo exercicio.
            </div>
          )}

          {(balanceExercise?.executivePowerBodies?.length ?? 0) > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="w-32 px-4 py-3">Codigo</th>
                    <th className="px-4 py-3">Poder Executivo</th>
                    <th className="px-4 py-3">Competencias</th>
                    <th className="w-28 px-4 py-3">Ocorrencias</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {balanceExercise?.executivePowerBodies?.map((item) => (
                    <tr key={item.code} className={!isExecutivePowerConsistent(balanceExercise) ? "bg-rose-50/40 text-rose-900" : "text-slate-700"}>
                      <td className="px-4 py-3 font-bold">{item.code}</td>
                      <td className="break-words px-4 py-3 font-semibold">{item.name}</td>
                      <td className="break-words px-4 py-3">{item.competences.join(" · ")}</td>
                      <td className="px-4 py-3 font-semibold">{item.occurrences}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section id="validacao-d1-00024" className={`${activeArea === "validacao-d1-00024" ? "block" : "hidden"} panel mt-5 scroll-mt-5 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-pink-700">D1 · D1_00024</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">Dados do Legislativo repetidos entre competências</h2>
              <p className="mt-1 max-w-4xl text-sm text-slate-500">
                Compara todas as linhas classificadas como Poder Legislativo e sinaliza competências diferentes que possuem exatamente o mesmo conjunto de dados.
              </p>
            </div>
            <div className={`rounded-lg border px-4 py-3 text-right ${
              balanceExercise && !isLegislativePowerConsistent(balanceExercise)
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}>
              <p className="text-xs font-semibold uppercase opacity-70">Grupos repetidos</p>
              <p className="mt-1 text-2xl font-semibold">{balanceExercise?.legislativeDuplicateGroups?.length ?? 0}</p>
            </div>
          </div>

          {!balanceExercise && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Importe as MSC do exercicio para iniciar a verificacao D1_00024.
            </div>
          )}

          {balanceExercise && !hasLegislativeData(balanceExercise) && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Nenhum dado classificado como Poder Legislativo foi encontrado. As MSC importadas antes desta atualização precisam ser reimportadas para a comparação.
            </div>
          )}

          {balanceExercise && hasLegislativeData(balanceExercise) && isLegislativePowerConsistent(balanceExercise) && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              Não foram encontrados dados do Legislativo exatamente iguais entre competências diferentes do exercício {balanceExercise.year}.
            </div>
          )}

          {balanceExercise && !isLegislativePowerConsistent(balanceExercise) && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
              Possível inconsistência: os mesmos dados do Legislativo foram enviados em competências diferentes.
            </div>
          )}

          {(balanceExercise?.legislativeDuplicateGroups?.length ?? 0) > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Competências com dados iguais</th>
                    <th className="w-40 px-4 py-3">Linhas comparadas</th>
                    <th className="w-40 px-4 py-3">Regra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {balanceExercise?.legislativeDuplicateGroups?.map((item) => (
                    <tr key={item.competences.join("-")} className="bg-rose-50/40 text-rose-900">
                      <td className="break-words px-4 py-3 font-bold">{item.competences.join(" · ")}</td>
                      <td className="px-4 py-3 font-semibold">{item.rows}</td>
                      <td className="px-4 py-3 font-semibold">D1_00024</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section id="validacao-d1-00027" className={`${activeArea === "validacao-d1-00027" ? "block" : "hidden"} panel mt-5 scroll-mt-5 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-pink-700">D1 · D1_00027</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">Fonte de Recursos obrigatória e válida</h2>
              <p className="mt-1 max-w-4xl text-sm text-slate-500">
                Nas linhas em que TIPO2 é FR, exige o preenchimento de IC2 e valida o código na tabela resource_sources_2026.
              </p>
            </div>
            <div className={`rounded-lg border px-4 py-3 text-right ${
              resourceSourceValidation.issues.length > 0
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}>
              <p className="text-xs font-semibold uppercase opacity-70">Inconsistências</p>
              <p className="mt-1 text-2xl font-semibold">{resourceSourceValidation.issues.length}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <DataPoint label="Linhas TIPO2 = FR" value={resourceSourceValidation.checked} />
            <DataPoint label="Fontes válidas" value={resourceSourceValidation.valid} />
            <DataPoint label="Fontes ausentes" value={resourceSourceValidation.issues.filter((item) => item.reason === "missing").length} />
            <DataPoint label="Fontes inválidas" value={resourceSourceValidation.issues.filter((item) => item.reason === "invalid").length} />
          </div>

          {sourceCsv.rows.length > 0 && (!resourceSourceValidation.ic2Column || !resourceSourceValidation.type2Column) && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Não foi possível identificar as colunas TIPO2 e IC2. A regra D1_00027 não pode ser conferida.
            </div>
          )}

          {resourceSources.length === 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              A tabela de Fontes de Recursos 2026 não está disponível para validação.
            </div>
          )}

          {sourceCsv.rows.length > 0 && resourceSources.length > 0 && resourceSourceValidation.ic2Column && resourceSourceValidation.type2Column && resourceSourceValidation.issues.length === 0 && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              Todas as linhas com TIPO2 igual a FR possuem uma Fonte de Recursos válida em IC2.
            </div>
          )}

          {resourceSourceValidation.issues.length > 0 && (
            <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-rose-200">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="sticky top-0 bg-rose-50 text-xs uppercase text-rose-700">
                  <tr>
                    <th className="w-24 px-4 py-3">Linha</th>
                    <th className="px-4 py-3">Conta ou referência</th>
                    <th className="w-36 px-4 py-3">IC2</th>
                    <th className="w-48 px-4 py-3">Ocorrência</th>
                    <th className="w-32 px-4 py-3">Regra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rose-100">
                  {resourceSourceValidation.issues.map((issue) => (
                    <tr key={`${issue.rowNumber}-${issue.code}-${issue.reason}`} className="bg-rose-50/40 text-rose-900">
                      <td className="px-4 py-3 font-semibold">{issue.rowNumber}</td>
                      <td className="break-words px-4 py-3 font-semibold">{issue.reference || "-"}</td>
                      <td className="px-4 py-3 font-bold">{issue.code || "Não informado"}</td>
                      <td className="px-4 py-3 font-semibold">{issue.reason === "missing" ? "Fonte ausente" : "Fonte inválida"}</td>
                      <td className="px-4 py-3 font-semibold">D1_00027</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section id="validacao-d1-00028" className={`${activeArea === "validacao-d1-00028" ? "block" : "hidden"} panel mt-5 scroll-mt-5 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-pink-700">D1 · D1_00028</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">Valores em todas as classes da MSC</h2>
              <p className="mt-1 max-w-4xl text-sm text-slate-500">
                Verifica se existem valores diferentes de zero nas classes patrimoniais (1 a 4), orçamentárias (5 e 6) e de controle (7 e 8).
              </p>
            </div>
            <div className={`rounded-lg border px-4 py-3 text-right ${
              accountClassCoverageValidation.passed
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900"
            }`}>
              <p className="text-xs font-semibold uppercase opacity-70">Pontuação desta MSC</p>
              <p className="mt-1 text-2xl font-semibold">{accountClassCoverageValidation.passed ? "1/13" : "0/13"}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {ACCOUNT_CLASS_GROUPS.map((group) => {
              const groupClasses = accountClassCoverageValidation.classes.filter((item) =>
                (group.classes as readonly string[]).includes(item.accountClass),
              );
              const missing = groupClasses.filter((item) => item.nonZeroRows === 0);
              const nonZeroRows = groupClasses.reduce((total, item) => total + item.nonZeroRows, 0);

              return (
                <div
                  key={group.label}
                  className={`rounded-lg border px-4 py-4 ${
                    missing.length === 0
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-rose-200 bg-rose-50 text-rose-900"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase opacity-70">Classes {group.classes.join(", ")}</p>
                      <p className="mt-1 text-lg font-semibold">{group.label}</p>
                    </div>
                    <p className="text-2xl font-semibold">{nonZeroRows}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {groupClasses.map((item) => (
                      <span
                        key={item.accountClass}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                          item.nonZeroRows > 0
                            ? "border-emerald-300 bg-white text-emerald-800"
                            : "border-rose-300 bg-white text-rose-800"
                        }`}
                      >
                        Classe {item.accountClass}: {item.nonZeroRows}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 text-xs font-medium opacity-80">
                    {missing.length === 0
                      ? "Todas as classes do grupo possuem valores diferentes de zero."
                      : `Classes ausentes: ${missing.map((item) => item.accountClass).join(", ")}.`}
                  </p>
                </div>
              );
            })}
          </div>

          {sourceCsv.rows.length > 0 && (!accountClassCoverageValidation.accountColumn || !accountClassCoverageValidation.valueColumn) && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Não foi possível identificar as colunas de conta e valor. A regra D1_00028 não pode ser conferida.
            </div>
          )}

          {sourceCsv.rows.length > 0 && accountClassCoverageValidation.accountColumn && accountClassCoverageValidation.valueColumn && accountClassCoverageValidation.passed && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              A MSC possui valores diferentes de zero em todas as classes de contas e alcançou 1/13 da pontuação da regra.
            </div>
          )}

          {sourceCsv.rows.length > 0 && accountClassCoverageValidation.accountColumn && accountClassCoverageValidation.valueColumn && !accountClassCoverageValidation.passed && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
              A MSC não possui valores diferentes de zero nas classes: {accountClassCoverageValidation.missingClasses.join(", ") || "1 a 8"}.
            </div>
          )}
        </section>

        <section id="validacao-d1-00020" className={`${activeArea === "validacao-d1-00020" ? "block" : "hidden"} panel mt-5 scroll-mt-5 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-pink-700">D1 · D1_00020</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">Continuidade dos saldos entre competencias</h2>
              <p className="mt-1 max-w-4xl text-sm text-slate-500">
                Compara o ending_balance da competencia anterior com o beginning_balance da competencia importada,
                usando como chave todas as colunas anteriores a Valor, Tipo de Valor e Natureza de Valor.
              </p>
            </div>
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-right">
              <p className="text-xs font-semibold uppercase text-rose-700">Possiveis diferencas</p>
              <p className="mt-1 text-2xl font-semibold text-rose-950">
                {balanceLoading ? "..." : balanceComparison?.differences.length ?? 0}
              </p>
            </div>
          </div>

          {balanceError && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              {balanceError}
            </div>
          )}

          {balanceLoading && (
            <div className="mt-4 rounded-lg border border-pink-200 bg-pink-50 px-4 py-3 text-sm font-medium text-pink-800">
              Gravando os saldos e comparando as competencias...
            </div>
          )}

          {balanceComparison?.status === "no_previous" && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              Os saldos de {balanceComparison.competenceKey} foram gravados. Importe primeiro a MSC de {balanceComparison.previousCompetenceKey} para realizar a comparacao.
            </div>
          )}

          {balanceComparison?.status === "compared" && (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <DataPoint label="Competencia anterior" value={Number(balanceComparison.previousCompetenceKey.replace("-", ""))} />
                <DataPoint label="Competencia atual" value={Number(balanceComparison.competenceKey.replace("-", ""))} />
                <DataPoint label="Chaves comparadas" value={balanceComparison.compared} />
                <DataPoint label="Saldos iniciais zero ignorados" value={balanceComparison.ignoredZeroBeginning ?? 0} />
              </div>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Competencias armazenadas ({balanceComparison.storedCompetences?.length ?? 0})
                </p>
                <p className="mt-2 text-sm font-semibold text-slate-800">
                  {balanceComparison.storedCompetences?.join(" · ") || "Nenhuma competencia armazenada"}
                </p>
              </div>

              {balanceComparison.differences.length === 0 ? (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                  Nenhuma diferenca encontrada entre o saldo final de {balanceComparison.previousCompetenceKey} e o saldo inicial de {balanceComparison.competenceKey}.
                </div>
              ) : (
                <div className="mt-4 max-h-96 overflow-auto rounded-lg border border-rose-200">
                  <table className="min-w-[1100px] w-full text-left text-sm">
                    <thead className="sticky top-0 bg-rose-50 text-xs uppercase text-rose-700">
                      <tr>
                        <th className="px-4 py-3">Chave da linha</th>
                        <th className="w-24 px-4 py-3">Linha ant.</th>
                        <th className="w-24 px-4 py-3">Linha atual</th>
                        <th className="w-40 px-4 py-3">Saldo final</th>
                        <th className="w-40 px-4 py-3">Saldo inicial</th>
                        <th className="w-48 px-4 py-3">Ocorrencia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-rose-100">
                      {balanceComparison.differences.map((difference) => (
                        <tr key={difference.comparisonKey} className="bg-rose-50/40 text-rose-900">
                          <td className="break-words px-4 py-3 text-xs">{difference.keyValues.join(" | ")}</td>
                          <td className="px-4 py-3 font-semibold">{difference.previousRowNumber ?? "-"}</td>
                          <td className="px-4 py-3 font-semibold">{difference.currentRowNumber ?? "-"}</td>
                          <td className="px-4 py-3 font-semibold">{formatBalance(difference.endingValue, difference.endingNature)}</td>
                          <td className="px-4 py-3 font-semibold">{formatBalance(difference.beginningValue, difference.beginningNature)}</td>
                          <td className="px-4 py-3 font-semibold">{balanceDifferenceLabel(difference.reason)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {balanceExercise && (
            <div className="mt-5 border-t border-slate-200 pt-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">Analise do exercicio {balanceExercise.year}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {balanceExercise.storedCompetences.length} de 12 competencias armazenadas.
                  </p>
                </div>
                <span className="rounded-full bg-pink-100 px-3 py-1 text-sm font-semibold text-pink-800">
                  {balanceExercise.transitions.filter((item) => item.status === "compared").length} de 11 transicoes analisadas
                </span>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {balanceExercise.transitions.map((transition) => (
                  <div
                    key={transition.competenceKey}
                    className={`rounded-lg border px-4 py-3 ${
                      transition.status === "pending"
                        ? "border-slate-200 bg-slate-50 text-slate-600"
                        : transition.differences > 0
                          ? "border-rose-200 bg-rose-50 text-rose-800"
                          : "border-emerald-200 bg-emerald-50 text-emerald-800"
                    }`}
                  >
                    <p className="text-xs font-semibold uppercase opacity-75">
                      {transition.previousCompetenceKey} → {transition.competenceKey}
                    </p>
                    <p className="mt-2 text-lg font-bold">
                      {transition.status === "pending"
                        ? "Aguardando competencias"
                        : `${transition.differences} possiveis diferencas`}
                    </p>
                    {transition.status === "compared" && (
                      <p className="mt-1 text-xs">
                        {transition.compared} chaves · {transition.ignoredZeroBeginning} saldos zero ignorados
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className={`${activeArea === "natureza-contas" ? "block" : "hidden"} panel mt-5 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Natureza das contas contabeis</h2>
              <p className="mt-1 text-sm text-slate-500">
                Valida as contas do ativo (classe 1) da Matriz usando a natureza oficial do PCASP Estendido 2026.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-full bg-slate-100 p-1 shadow-inner shadow-slate-200">
                {[
                  { label: "Exibir", value: true },
                  { label: "Recolher", value: false },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      showAccountNature === option.value
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                    onClick={() => setShowAccountNature(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-right">
                <p className="text-xs font-semibold uppercase text-rose-700">Invertidas</p>
                <p className="mt-1 text-2xl font-semibold text-rose-950">{accountNatureValidation.inverted}</p>
              </div>
            </div>
          </div>

          {showAccountNature && (
            <>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-500">Conta</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">
                    {accountNatureValidation.columns.account || "CONTA"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-500">Valor</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">
                    {accountNatureValidation.columns.value || "Valor"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-500">Tipo</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">
                    {accountNatureValidation.columns.valueType || "TIPO_VALOR"}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-slate-500">Natureza</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">
                    {accountNatureValidation.columns.nature || "NATUREZA_VALOR"}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <DataPoint label="Linhas da Matriz" value={sourceCsv.rows.length} />
                <DataPoint label="Contas analisadas" value={accountNatureValidation.checked} />
                <DataPoint label="Corretas" value={accountNatureValidation.correct} />
                <DataPoint label="Invertidas" value={accountNatureValidation.inverted} />
                <DataPoint label="Sem natureza" value={accountNatureValidation.withoutNature} />
                <DataPoint label="Fora de ending_balance" value={accountNatureValidation.ignoredType} />
                <DataPoint label="Saldo zero ignorado" value={accountNatureValidation.ignoredZeroBalance} />
              </div>

              <div className="mt-4 inline-flex rounded-full bg-slate-100 p-1 shadow-inner shadow-slate-200">
                {[
                  { label: "Todas", value: "todas" },
                  { label: "Corretas", value: "corretas" },
                  { label: "Invertidas", value: "invertidas" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      accountNatureFilter === option.value
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-slate-500 hover:text-slate-900"
                    }`}
                    onClick={() => setAccountNatureFilter(option.value as AccountNatureFilter)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {sourceCsv.rows.length > 0 && accountNatureValidation.checked === 0 && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                  A Matriz foi importada, mas nao foi possivel identificar valores validos na coluna P. Verifique se a coluna P esta selecionada corretamente.
                </div>
              )}

              <div className="mt-4 max-h-72 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-200">
                <table className="w-full table-fixed text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="w-24 px-4 py-3">Linha</th>
                      <th className="px-4 py-3">Conta</th>
                      <th className="px-4 py-3">Conta + tipo</th>
                      <th className="w-28 px-4 py-3">PCASP</th>
                      <th className="w-28 px-4 py-3">Esperado</th>
                      <th className="w-28 px-4 py-3">Natureza</th>
                      <th className="w-28 px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAccountNatureRows.map((issue) => (
                      <tr
                        key={`${issue.rowNumber}-${issue.account}-${issue.actualNature}`}
                        className={issue.status === "Invertido" ? "bg-rose-50 text-rose-800" : "text-slate-700"}
                      >
                        <td className="px-4 py-3 font-semibold">{issue.rowNumber}</td>
                        <td className="break-words px-4 py-3 font-semibold">{issue.account}</td>
                        <td className="break-words px-4 py-3 font-semibold">{issue.comparisonKey}</td>
                        <td className="px-4 py-3 font-bold">{issue.accountClass}</td>
                        <td className="px-4 py-3 font-bold">{issue.expectedNature}</td>
                        <td className="px-4 py-3 font-bold">{issue.actualNature || "-"}</td>
                        <td className="px-4 py-3 font-bold">{issue.status}</td>
                      </tr>
                    ))}
                    {filteredAccountNatureRows.length === 0 && (
                      <tr>
                        <td className="px-4 py-8 text-center text-slate-500" colSpan={7}>
                          Nenhuma conta para este filtro.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className={`${activeArea === "regras-salvas" ? "block" : "hidden"} panel mt-5 p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Regras salvas no banco</h2>
              <p className="mt-1 text-sm text-slate-500">
                Checklist STN importado para SQLite e disponivel para orientar os mapeamentos.
              </p>
            </div>
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-right">
              <p className="text-xs font-semibold uppercase text-cyan-700">Total</p>
              <p className="mt-1 text-2xl font-semibold text-cyan-950">
                {rulesLoading ? "..." : storedRules.length}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            {ruleDimensions.map((dimension) => (
              <DataPoint
                key={dimension}
                label={dimension}
                value={rulesSummary
                  .filter((item) => item.dimension === dimension)
                  .reduce((total, item) => total + item.total, 0)}
              />
            ))}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr]">
            <select
              className="form-field"
              value={selectedPeriodicityFilter}
              onChange={(event) => setSelectedPeriodicityFilter(event.target.value as PeriodicityFilter)}
              aria-label="Filtrar regras por periodicidade"
            >
              <option value="todas">Todas as periodicidades</option>
              <option value="monthly">Mensal</option>
              <option value="bimonthly">Bimestral</option>
              <option value="four_monthly">Quadrimestral</option>
              <option value="annual">Anual</option>
              <option value="not_applicable">Não se aplica</option>
            </select>
            <input
              className="form-field"
              value={rulesSearch}
              onChange={(event) => setRulesSearch(event.target.value)}
              placeholder="Buscar por codigo, regra, periodicidade ou status"
            />
          </div>

          <div className="mt-4 space-y-4">
          {ruleDimensions.map((dimension) => {
            const dimensionRules = visibleRules.filter((rule) => rule.dimension === dimension);
            return (
          <section key={dimension} className="overflow-hidden rounded-lg border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="font-semibold text-slate-950">Dimensão {dimension}</h3>
              <span className="text-sm font-medium text-slate-500">{dimensionRules.length} regras</span>
            </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full min-w-[1050px] table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[8%]" />
                <col className="w-[10%]" />
                <col className="w-[14%]" />
                <col className="w-[35%]" />
                <col className="w-[25%]" />
                <col className="w-[5%]" />
                <col className="w-[3%]" />
              </colgroup>
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Dimensao</th>
                  <th className="px-4 py-3">Codigo</th>
                  <th className="px-4 py-3">Periodicidade</th>
                  <th className="px-4 py-3">Regra</th>
                  <th className="px-4 py-3">Periodos</th>
                  <th className="px-2 py-3">Status</th>
                  <th className="px-2 py-3"><span className="sr-only">Acoes</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dimensionRules.map((rule) => {
                  const selectedPeriodicity = periodicityByRule.get(rule.code) ?? inferRulePeriodicity(rule.item);
                  const periodicity = getRulePeriodicity(selectedPeriodicity);
                  const savedPeriods = checksByRule.get(rule.code);
                  const ruleCompleted = Boolean(savedPeriods && [...savedPeriods.values()].some((check) => check.completedDate || check.quantity != null));
                  const isAutomaticAccountNatureRule = automaticResultsByRule.has(rule.code) || IMPLEMENTED_RULE_AREAS[rule.code] !== undefined;
                  const automaticCheckExecuted = isAutomaticAccountNatureRule
                    && sourceCsv.rows.length > 0
                    && pcaspAccounts.length > 0;
                  const automaticCheckPassed = automaticCheckExecuted
                    && accountNatureValidation.checked > 0
                    && accountNatureValidation.inverted === 0
                    && accountNatureValidation.withoutNature === 0;
                  const persistedAutomaticResult = automaticResultsByRule.get(rule.code);
                  const displayedRuleCompleted = isAutomaticAccountNatureRule
                    ? (persistedAutomaticResult ?? automaticCheckPassed)
                    : ruleCompleted;
                  const displayedRulePartial = rule.code === "D1_00028" && displayedRuleCompleted;
                  return (
                  <tr key={rule.id} className="hover:bg-slate-50">
                    <td className="break-words px-4 py-3 font-semibold text-slate-800">{rule.dimension}</td>
                    <td className="break-words px-4 py-3 font-medium text-slate-950">{rule.code}</td>
                    <td className="px-4 py-3">
                      {isAutomaticAccountNatureRule ? (
                        <span className="mx-auto flex w-fit rounded-md bg-cyan-50 px-2.5 py-1.5 text-[0.9rem] font-semibold text-cyan-700">
                          Automática
                        </span>
                      ) : (
                        <select
                          className="form-field min-w-0 max-w-full"
                          aria-label={`Periodicidade da regra ${rule.code}`}
                          value={selectedPeriodicity}
                          onChange={(event) => openRuleChecks(rule, event.target.value as PeriodicityKey)}
                        >
                          <option value="monthly">Mensal</option>
                          <option value="bimonthly">Bimestral</option>
                          <option value="four_monthly">Quadrimestral</option>
                          <option value="annual">Anual</option>
                          <option value="not_applicable">Não se aplica</option>
                        </select>
                      )}
                    </td>
                    <td className="whitespace-normal break-words px-4 py-3 leading-relaxed text-slate-600">{rule.item}</td>
                    <td className="overflow-hidden px-4 py-3">
                      {periodicity.periods > 0 ? (
                        <div className="flex w-full gap-1" aria-label={`${periodicity.periods} periodos`}>
                          {Array.from({ length: periodicity.periods }, (_, index) => {
                            const check = savedPeriods?.get(index + 1);
                            const date = check?.completedDate;
                            const quantity = check?.quantity;
                            const hasQuantity = QUANTITY_RULE_CODES.has(rule.code) && quantity !== null && quantity !== undefined;
                            const periodPassed = isAutomaticAccountNatureRule ? (persistedAutomaticResult ?? automaticCheckPassed) : Boolean(date);
                            const periodTitle = isAutomaticAccountNatureRule
                              ? automaticCheckExecuted
                                ? `Verificação automática executada: ${accountNatureValidation.correct} corretas, ${accountNatureValidation.inverted} invertidas e ${accountNatureValidation.withoutNature} sem natureza`
                                : "Importe a MSC para executar a verificação automática"
                              : date
                                ? `${index + 1}º ${periodicity.periodLabel}: ${formatDate(date)}`
                                : `${index + 1}º ${periodicity.periodLabel}: pendente`;
                            return (
                              <span
                                key={index}
                                title={periodTitle}
                                className={`flex h-7 min-w-0 flex-1 items-center justify-center rounded-md border text-sm font-bold ${
                                  hasQuantity
                                    ? "border-orange-400 bg-orange-100 text-orange-700"
                                    : periodPassed
                                    ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                                    : "border-rose-300 bg-rose-50 text-rose-600"
                                }`}
                              >
                                {hasQuantity ? quantity : periodPassed ? "✓" : "×"}
                              </span>
                            );
                          })}
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-3">
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${
                        displayedRuleCompleted
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-700"
                      }`}>
                        {displayedRulePartial ? "PARCIAL (1/13)" : displayedRuleCompleted ? "REALIZADO" : isAutomaticAccountNatureRule ? "PENDENTE" : rule.status}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-center">
                      {!isAutomaticAccountNatureRule && (
                        <button
                          type="button"
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-lg font-bold leading-none text-slate-600 hover:border-cyan-600 hover:text-cyan-700 disabled:cursor-not-allowed disabled:opacity-40"
                          title={periodicity.periods ? "Informar datas" : "Periodicidade não identificada"}
                          onClick={() => openRuleChecks(rule)}
                        >
                          …
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })}
                {!rulesLoading && dimensionRules.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={7}>
                      Nenhuma regra encontrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          </section>
            );
          })}
          </div>
        </section>

        {editingRule && (
          <RuleChecksDialog
            rule={editingRule}
            periodicityKey={editingPeriodicity}
            dates={editingDates}
            quantities={editingQuantities}
            error={checksError}
            saving={savingChecks}
            onChange={setEditingDates}
            onQuantityChange={setEditingQuantities}
            onClose={() => setEditingRule(null)}
            onSave={saveRuleChecks}
          />
        )}

        <section className={`${activeArea === "mapeamentos" ? "block" : "hidden"} panel mt-5 p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Mapeamentos</h2>
              <p className="mt-1 text-sm text-slate-500">
                Cada linha indica onde o arquivo A busca no arquivo B e qual regra deve validar.
              </p>
            </div>
            <button
              type="button"
              className="form-button-secondary"
              disabled={sourceCsv.headers.length === 0 || targetCsv.headers.length === 0}
              onClick={addMapping}
            >
              Adicionar regra
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2 text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1">Coluna A</th>
                  <th className="px-2 py-1">Coluna B</th>
                  <th className="px-2 py-1">Regra</th>
                  <th className="px-2 py-1">Tolerancia</th>
                  <th className="px-2 py-1 text-right">Acao</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <tr key={mapping.id} className="bg-slate-50">
                    <td className="rounded-l-lg px-2 py-2">
                      <SelectField
                        value={mapping.sourceColumn}
                        options={sourceCsv.headers}
                        onChange={(value) => updateMapping(mapping.id, { sourceColumn: value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <SelectField
                        value={mapping.targetColumn}
                        options={targetCsv.headers}
                        onChange={(value) => updateMapping(mapping.id, { targetColumn: value })}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <select
                        className="form-field"
                        value={mapping.rule}
                        onChange={(event) =>
                          updateMapping(mapping.id, { rule: event.target.value as ComparisonRuleKind })
                        }
                      >
                        {RULES.map((rule) => (
                          <option key={rule} value={rule}>
                            {ruleLabel(rule)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2">
                      <input
                        className="form-field"
                        disabled={mapping.rule !== "number"}
                        min="0"
                        step="0.01"
                        type="number"
                        value={mapping.tolerance ?? 0}
                        onChange={(event) =>
                          updateMapping(mapping.id, { tolerance: Number(event.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="rounded-r-lg px-2 py-2 text-right">
                      <button
                        type="button"
                        className="rounded-lg px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                        onClick={() => removeMapping(mapping.id)}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
                {mappings.length === 0 && (
                  <tr>
                    <td className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500" colSpan={5}>
                      Nenhum mapeamento definido. Sem regras, a comparacao valida apenas a existencia das chaves.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${activeArea === "mapeamentos" ? "grid" : "hidden"} mt-5 gap-4 md:grid-cols-4`}>
          <SummaryCard label="Conferidos" value={summary.ok} tone="emerald" />
          <SummaryCard label="Divergentes" value={summary.different} tone="amber" />
          <SummaryCard label="Ausentes no B" value={summary.missingTarget} tone="rose" />
          <SummaryCard label="Ausentes no A" value={summary.missingSource} tone="slate" />
        </section>

        <section className={`${activeArea === "mapeamentos" ? "block" : "hidden"} panel mt-5 overflow-hidden`}>
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-950">Resultado</h2>
            <p className="mt-1 text-sm text-slate-500">
              {summary.total > 0 ? `${summary.total} chaves analisadas.` : "Carregue os arquivos para iniciar."}
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Chave</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Divergencias</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewResults.map((result) => (
                  <tr key={`${result.key}-${result.status}`}>
                    <td className="max-w-56 truncate px-4 py-3 font-medium text-slate-950">{result.key || "(vazio)"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={result.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {result.issues.length > 0
                        ? result.issues.map((issue) => issue.message).join(" | ")
                        : statusLabel(result.status)}
                    </td>
                  </tr>
                ))}
                {previewResults.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-slate-500" colSpan={3}>
                      Nenhum resultado para exibir.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
      </div>
    </main>
  );
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function inferRulePeriodicity(item: string): PeriodicityKey {
  const text = normalizeSearch(item);
  if (text.includes("dca") || text.includes("anual")) {
    return "annual";
  }
  if (text.includes("rgf") || text.includes("quadrimestr")) {
    return "four_monthly";
  }
  if (text.includes("rreo") || text.includes("bimestr")) {
    return "bimonthly";
  }
  return "annual";
}

function getRulePeriodicity(key: PeriodicityKey | string | null | undefined): RulePeriodicity {
  const periodicities: Record<PeriodicityKey, RulePeriodicity> = {
    monthly: { key: "monthly", label: "Mensal", periods: 12, periodLabel: "Mês" },
    bimonthly: { key: "bimonthly", label: "Bimestral", periods: 6, periodLabel: "Bimestre" },
    four_monthly: { key: "four_monthly", label: "Quadrimestral", periods: 3, periodLabel: "Quadrimestre" },
    annual: { key: "annual", label: "Anual", periods: 1, periodLabel: "Ano" },
    not_applicable: { key: "not_applicable", label: "Não se aplica", periods: 0, periodLabel: "Período" },
  };
  return periodicities[key as PeriodicityKey] ?? periodicities.annual;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatCpf(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function UsersDialog({ currentUserId, users, loading, error, onClose, onSave }: {
  currentUserId: number;
  users: AppUser[];
  loading: boolean;
  error: string;
  onClose: () => void;
  onSave: (input: { id?: number; displayName: string; cpf: string; email: string; password: string; active: boolean }) => Promise<void>;
}) {
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");

  function resetForm(user?: AppUser) {
    setEditing(user ?? null);
    setDisplayName(user?.displayName ?? "");
    setCpf(user ? formatCpf(user.cpf) : "");
    setEmail(user?.email ?? "");
    setPassword("");
    setLocalError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setLocalError("");
    try {
      await onSave({ id: editing?.id, displayName, cpf, email, password, active: editing ? Boolean(editing.active) : true });
      resetForm();
    } catch (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o usuário.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleUser(user: AppUser) {
    setLocalError("");
    try {
      await onSave({ id: user.id, displayName: user.displayName, cpf: user.cpf, email: user.email, password: "", active: !Boolean(user.active) });
    } catch (saveError) {
      setLocalError(saveError instanceof Error ? saveError.message : "Não foi possível alterar o status.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="users-title" className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-xs font-semibold uppercase text-cyan-700">Cadastros</p><h2 id="users-title" className="mt-1 text-xl font-semibold text-slate-950">Cadastro de usuários</h2></div>
          <button type="button" className="rounded-md px-2 py-1 text-xl text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Fechar">×</button>
        </div>

        <form className="mt-5 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-2" onSubmit={submit}>
          <input className="form-field" placeholder="Nome" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <input className="form-field" placeholder="CPF" required value={cpf} onChange={(event) => setCpf(formatCpf(event.target.value))} />
          <input className="form-field" type="email" placeholder="E-mail" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <input className="form-field md:col-span-2" type="password" minLength={editing ? undefined : 12} placeholder={editing ? "Nova senha (opcional)" : "Senha (mínimo de 12 caracteres)"} required={!editing} value={password} onChange={(event) => setPassword(event.target.value)} />
          <div className="flex gap-2 md:col-span-2">
            <button className="form-button-primary" disabled={saving} type="submit">{saving ? "Salvando..." : editing ? "Atualizar usuário" : "Cadastrar usuário"}</button>
            {editing && <button className="form-button-secondary" type="button" onClick={() => resetForm()}>Cancelar edição</button>}
          </div>
        </form>

        {(error || localError) && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{localError || error}</p>}
        <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Nome</th><th className="px-4 py-3">CPF</th><th className="px-4 py-3">E-mail</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((user) => <tr key={user.id}>
                <td className="px-4 py-3 font-semibold text-slate-900">{user.displayName}</td><td className="px-4 py-3 text-slate-600">{formatCpf(user.cpf)}</td><td className="px-4 py-3 text-slate-600">{user.email}</td>
                <td className="px-4 py-3"><span className={`rounded-md px-2 py-1 text-xs font-semibold ${user.active ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{user.active ? "ATIVO" : "BLOQUEADO"}</span></td>
                <td className="px-4 py-3"><div className="flex justify-end gap-2"><button type="button" className="form-button-secondary" onClick={() => resetForm(user)}>Editar</button><button type="button" className="form-button-secondary" disabled={user.id === currentUserId} title={user.id === currentUserId ? "O usuário conectado não pode ser bloqueado" : undefined} onClick={() => toggleUser(user)}>{user.active ? "Bloquear" : "Ativar"}</button></div></td>
              </tr>)}
              {!loading && users.length === 0 && <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={5}>Nenhum usuário cadastrado.</td></tr>}
              {loading && <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={5}>Carregando usuários...</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OrganizationsDialog({ organizations, error, onClose, onSave }: {
  organizations: Organization[];
  error: string;
  onClose: () => void;
  onSave: (input: Omit<Organization, "id"> & { id?: number }) => Promise<void>;
}) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={onClose}>
    <section role="dialog" aria-modal="true" aria-labelledby="organizations-title" className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-cyan-700">Cadastros</p><h2 id="organizations-title" className="mt-1 text-xl font-semibold text-slate-950">Cadastro de empresas</h2></div><button type="button" className="rounded-md px-2 py-1 text-xl text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Fechar">×</button></div>
      {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
      <OrganizationsManager organizations={organizations} onSave={onSave} />
    </section>
  </div>;
}

function OrganizationsManager({ organizations, onSave }: { organizations: Organization[]; onSave: (input: Omit<Organization, "id"> & { id?: number }) => Promise<void> }) {
  const empty = { code: "", name: "", document: "", organizationType: "Prefeitura Municipal", state: "", municipality: "", email: "", environment: "production" as const, active: 1 };
  const [form, setForm] = useState<Omit<Organization, "id"> & { id?: number }>(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try { await onSave(form); setForm(empty); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar a empresa."); } finally { setSaving(false); }
  }
  async function toggle(item: Organization) {
    try { await onSave({ ...item, active: item.active ? 0 : 1 }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível alterar a empresa."); }
  }
  return <div className="mt-8 border-t border-slate-200 pt-6">
    <h3 className="text-lg font-semibold text-slate-950">Cadastro de empresas e municípios</h3><p className="mt-1 text-sm text-slate-500">Cada empresa representa um ambiente disponível após o login.</p>
    <form className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-3" onSubmit={submit}>
      <MunicipalityCodeField value={form.code} onChange={(code) => setForm({ ...form, code, state: "", municipality: "" })} onSelect={(municipality) => setForm({ ...form, code: municipality.code, state: municipality.stateCode, municipality: municipality.name })} />
      <input className="form-field md:col-span-2" placeholder="Nome da empresa / unidade gestora" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <input className="form-field" placeholder="CNPJ" value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />
      <select className="form-field" value={form.organizationType} onChange={(e) => setForm({ ...form, organizationType: e.target.value })}><option>Prefeitura Municipal</option><option>Câmara Municipal</option><option>Autarquia</option><option>Consórcio Público</option></select>
      <select className="form-field" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value as Organization["environment"] })}><option value="production">Produção</option><option value="demonstration">Demonstração</option></select>
      <input className="form-field bg-slate-100" placeholder="UF (automático)" value={form.state} readOnly />
      <input className="form-field bg-slate-100" placeholder="Município (automático)" value={form.municipality} readOnly />
      <input className="form-field" type="email" placeholder="E-mail" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <div className="flex gap-2 md:col-span-3"><button className="form-button-primary" disabled={saving}>{saving ? "Salvando..." : form.id ? "Atualizar empresa" : "Cadastrar empresa"}</button>{form.id && <button type="button" className="form-button-secondary" onClick={() => setForm(empty)}>Cancelar edição</button>}</div>
    </form>
    {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-4 py-3">Código IBGE</th><th className="px-4 py-3">Empresa</th><th className="px-4 py-3">Município</th><th className="px-4 py-3">Ambiente</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ações</th></tr></thead><tbody className="divide-y divide-slate-100">
      {organizations.map((item) => <tr key={item.id}><td className="px-4 py-3 font-semibold">{item.code}</td><td className="px-4 py-3">{item.name}</td><td className="px-4 py-3">{[item.municipality, item.state].filter(Boolean).join("/") || "-"}</td><td className="px-4 py-3">{item.environment === "demonstration" ? "Demonstração" : "Produção"}</td><td className="px-4 py-3">{item.active ? "ATIVA" : "BLOQUEADA"}</td><td className="px-4 py-3"><div className="flex justify-end gap-2"><button className="form-button-secondary" type="button" onClick={() => setForm(item)}>Editar</button><button className="form-button-secondary" type="button" onClick={() => toggle(item)}>{item.active ? "Bloquear" : "Ativar"}</button></div></td></tr>)}
    </tbody></table></div>
  </div>;
}

type IbgeMunicipality = { code: string; name: string; stateCode: string; stateName: string };

function MunicipalityCodeField({ value, onChange, onSelect }: { value: string; onChange: (value: string) => void; onSelect: (municipality: IbgeMunicipality) => void }) {
  const [results, setResults] = useState<IbgeMunicipality[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedCode, setSelectedCode] = useState("");
  useEffect(() => {
    if (value.length < 2 || value === selectedCode) { setResults([]); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setSearched(false);
      fetch(`/api/organizations/municipalities?q=${encodeURIComponent(value)}`, { signal: controller.signal })
        .then((response) => response.json()).then((data) => { setResults(data.municipalities ?? []); setOpen(true); setSearched(true); })
        .catch(() => undefined).finally(() => setLoading(false));
    }, 250);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [selectedCode, value]);
  return <div className="relative">
    <input className="form-field" placeholder="Digite o código IBGE ou município" required autoComplete="off" value={value} onFocus={() => setOpen(true)} onChange={(event) => { setSelectedCode(""); onChange(event.target.value); setOpen(true); }} />
    {open && value.length >= 2 && (loading || searched) && <div className="absolute z-50 mt-1 max-h-64 w-full min-w-96 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
      {loading && <p className="px-3 py-3 text-sm text-slate-500">Buscando municípios...</p>}
      {!loading && searched && results.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">Nenhum município encontrado.</p>}
      {!loading && results.map((municipality) => <button key={municipality.code} type="button" className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-cyan-50" onMouseDown={(event) => event.preventDefault()} onClick={() => { setSelectedCode(municipality.code); onSelect(municipality); setOpen(false); setResults([]); }}><span className="font-semibold text-slate-900">{municipality.code}</span><span className="ml-2 text-slate-600">{municipality.name} - {municipality.stateCode}</span></button>)}
    </div>}
  </div>;
}

function isExecutivePowerConsistent(exercise: MscExerciseSummary) {
  if (typeof exercise.executiveConsistent === "boolean") return exercise.executiveConsistent;
  const codes = exercise.executivePowerBodies?.map((item) => item.code) ?? [];
  return codes.length <= 1 || codes.every((code) => code === "10131" || code === "10132");
}

function isLegislativePowerConsistent(exercise: MscExerciseSummary) {
  if (typeof exercise.legislativeConsistent === "boolean") return exercise.legislativeConsistent;
  return (exercise.legislativeDuplicateGroups?.length ?? 0) === 0;
}

function hasLegislativeData(exercise: MscExerciseSummary) {
  if (exercise.legislativeDataCompetences) return exercise.legislativeDataCompetences.length > 0;
  return (exercise.legislativePowerBodies?.length ?? 0) > 0;
}

function RuleChecksDialog({
  rule,
  periodicityKey,
  dates,
  quantities,
  error,
  saving,
  onChange,
  onQuantityChange,
  onClose,
  onSave,
}: {
  rule: StoredComparisonRule;
  periodicityKey: PeriodicityKey;
  dates: string[];
  quantities: string[];
  error: string;
  saving: boolean;
  onChange: (dates: string[]) => void;
  onQuantityChange: (quantities: string[]) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const periodicity = getRulePeriodicity(periodicityKey);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-checks-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="rule-checks-title" className="text-lg font-semibold text-slate-950">Datas de verificação</h2>
            <p className="mt-1 text-sm text-slate-500">{rule.code} · {periodicity.label}</p>
          </div>
          <button type="button" className="rounded-md px-2 py-1 text-xl text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-700">{rule.item}</p>
        <div className="mt-5 space-y-3">
          {dates.map((date, index) => (
            <label key={index} className={`grid items-center gap-2 ${QUANTITY_RULE_CODES.has(rule.code) ? "sm:grid-cols-[1fr_72px_190px]" : "sm:grid-cols-[1fr_190px]"}`}>
              <span className="text-sm font-semibold text-slate-700">{index + 1}º {periodicity.periodLabel}</span>
              {QUANTITY_RULE_CODES.has(rule.code) && (
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  className="form-field px-2 text-center font-semibold"
                  placeholder="QTD"
                  aria-label={`Quantidade do ${index + 1}º ${periodicity.periodLabel}`}
                  value={quantities[index] ?? ""}
                  onChange={(event) => onQuantityChange(quantities.map((current, currentIndex) => currentIndex === index ? event.target.value : current))}
                />
              )}
              <span className="flex items-center gap-2">
                <input
                  type="date"
                  className="form-field"
                  value={date}
                  onChange={(event) => onChange(dates.map((current, currentIndex) => currentIndex === index ? event.target.value : current))}
                />
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border font-bold ${date ? "border-emerald-300 bg-emerald-100 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-600"}`}>
                  {date ? "✓" : "×"}
                </span>
              </span>
            </label>
          ))}
        </div>
        {error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="form-button-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="form-button-primary" disabled={saving} onClick={onSave}>{saving ? "Salvando..." : "Salvar datas"}</button>
        </div>
      </section>
    </div>
  );
}

function FiscalRulesPanel({
  validation,
  documents,
  rules,
  hasFiscalFile,
}: {
  validation: FiscalValidationResult;
  documents: OfficialFiscalDocument[];
  rules: OfficialFiscalRule[];
  hasFiscalFile: boolean;
}) {
  const previewIssues = validation.issues.slice(0, 80);
  const packageLabel = rules[0]?.packageLabel ?? "Pacote oficial Siconfi RREO/RGF 2026";

  return (
    <section className="panel mt-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Validador Fiscal 2026</h2>
          <p className="mt-1 text-sm text-slate-500">
            {packageLabel} aplicado ao arquivo importado em FISCAL.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right">
          <DataPoint label="Linhas" value={validation.checkedRows} />
          <DataPoint label="Erros" value={validation.errors} />
          <DataPoint label="Avisos" value={validation.warnings} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold uppercase text-slate-500">Detectado</p>
          <p className="mt-1 text-xl font-semibold text-slate-950">{validation.detectedReport}</p>
        </div>
        {documents.map((document) => (
          <div key={document.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase text-slate-500">
              {document.report} {document.kind === "validation" ? "Validacao" : "Instrucoes"}
            </p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{document.fileName}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        {rules.map((rule) => (
          <div key={rule.code} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase text-slate-500">{rule.category}</p>
              <span
                className={`rounded-md px-2 py-1 text-xs font-semibold ${
                  rule.severity === "erro"
                    ? "bg-rose-100 text-rose-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {rule.severity}
              </span>
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-900">{rule.code}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">{rule.description}</p>
          </div>
        ))}
      </div>

      {!hasFiscalFile && (
        <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm font-medium text-cyan-800">
          Importe o XLS/XLSX em FISCAL para executar as regras 2026.
        </div>
      )}

      {hasFiscalFile && validation.issues.length === 0 && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          Nenhuma divergencia estrutural encontrada no arquivo Fiscal importado.
        </div>
      )}

      {previewIssues.length > 0 && (
        <div className="mt-4 max-h-80 overflow-y-auto overflow-x-hidden rounded-lg border border-slate-200">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="w-28 px-4 py-3">Regra</th>
                <th className="w-24 px-4 py-3">Sev.</th>
                <th className="w-40 px-4 py-3">Aba</th>
                <th className="w-24 px-4 py-3">Linha</th>
                <th className="w-44 px-4 py-3">Coluna</th>
                <th className="px-4 py-3">Ocorrencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {previewIssues.map((issue, index) => (
                <FiscalIssueRow key={`${issue.ruleCode}-${issue.sheetName}-${issue.rowNumber}-${issue.column}-${index}`} issue={issue} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function FiscalIssueRow({ issue }: { issue: FiscalValidationIssue }) {
  return (
    <tr className={issue.severity === "erro" ? "bg-rose-50 text-rose-800" : "text-slate-700"}>
      <td className="break-words px-4 py-3 text-xs font-semibold">{issue.ruleCode}</td>
      <td className="px-4 py-3 font-bold">{issue.severity}</td>
      <td className="break-words px-4 py-3 font-semibold">{issue.sheetName ?? "-"}</td>
      <td className="px-4 py-3 font-semibold">{issue.rowNumber ?? "-"}</td>
      <td className="break-words px-4 py-3 font-semibold">{issue.column ?? "-"}</td>
      <td className="break-words px-4 py-3">{issue.message}</td>
    </tr>
  );
}

function validatePowerBodies(csv: ParsedCsv, powerBodies: PowerBody[]): PowerBodyValidation {
  const column = csv.headers[1] && normalizeHeaderKey(csv.headers[1]) === "ic1"
    ? csv.headers[1]
    : "";

  if (!column || powerBodies.length === 0) {
    return { column, checked: 0, valid: 0, issues: [] };
  }

  const officialCodes = new Set(powerBodies.map((item) => normalizePowerBodyCode(item.code)).filter(Boolean));
  const issues: PowerBodyIssue[] = [];
  let checked = 0;
  let valid = 0;

  csv.rows.forEach((row, index) => {
    const rawCode = (row[column] ?? "").trim();
    if (!rawCode) return;

    const code = normalizePowerBodyCode(rawCode);
    checked += 1;

    if (code && officialCodes.has(code)) {
      valid += 1;
      return;
    }

    issues.push({
      rowNumber: Number(row.__rowNumber) || index + 3,
      code: rawCode,
    });
  });

  return { column, checked, valid, issues };
}

function validateRequiredPowerBodies(csv: ParsedCsv): RequiredPowerBodyValidation {
  const ic1Column = csv.headers.find((header) => normalizeHeaderKey(header) === "ic1") ?? "";
  const type1Column = csv.headers.find((header) => normalizeHeaderKey(header) === "tipo1") ?? "";
  const referenceColumn = findColumnByHeader(csv.headers, ["conta"], 0);

  if (!ic1Column || !type1Column) {
    return { ic1Column, type1Column, checked: 0, issues: [] };
  }

  const issues: RequiredPowerBodyValidation["issues"] = [];
  let checked = 0;

  csv.rows.forEach((row, index) => {
    if (normalizeSearch(row[type1Column] ?? "") !== "po") return;
    checked += 1;
    if (String(row[ic1Column] ?? "").trim()) return;

    issues.push({
      rowNumber: Number(row.__rowNumber) || index + 3,
      reference: String(row[referenceColumn] ?? "").trim(),
    });
  });

  return { ic1Column, type1Column, checked, issues };
}

function validateResourceSources(csv: ParsedCsv, resourceSources: ResourceSource[]): ResourceSourceValidation {
  const ic2Column = csv.headers.find((header) => normalizeHeaderKey(header) === "ic2") ?? "";
  const type2Column = csv.headers.find((header) => normalizeHeaderKey(header) === "tipo2") ?? "";
  const referenceColumn = findColumnByHeader(csv.headers, ["conta"], 0);
  const emptyResult: ResourceSourceValidation = {
    ic2Column,
    type2Column,
    checked: 0,
    valid: 0,
    issues: [],
  };

  if (!ic2Column || !type2Column) return emptyResult;

  const officialCodes = new Set(resourceSources.map((item) => normalizeResourceSourceCode(item.code)).filter(Boolean));
  const issues: ResourceSourceValidation["issues"] = [];
  let checked = 0;
  let valid = 0;

  csv.rows.forEach((row, index) => {
    if (normalizeSearch(row[type2Column] ?? "") !== "fr") return;
    checked += 1;
    const rawCode = String(row[ic2Column] ?? "").trim();
    const code = normalizeResourceSourceCode(rawCode);
    const issueBase = {
      rowNumber: Number(row.__rowNumber) || index + 3,
      reference: String(row[referenceColumn] ?? "").trim(),
      code: rawCode,
    };

    if (!code) {
      issues.push({ ...issueBase, reason: "missing" });
    } else if (officialCodes.size > 0 && !officialCodes.has(code)) {
      issues.push({ ...issueBase, reason: "invalid" });
    } else if (officialCodes.has(code)) {
      valid += 1;
    }
  });

  return { ic2Column, type2Column, checked, valid, issues };
}

function normalizeResourceSourceCode(value: string) {
  return value.trim().replace(/\.0$/, "").replace(/\D/g, "");
}

function normalizePowerBodyCode(value: string) {
  return value.trim().replace(/\.0$/, "").replace(/\D/g, "");
}

function validateAccountClassCoverage(csv: ParsedCsv): AccountClassCoverageValidation {
  const accountColumn = findColumnByHeader(csv.headers, ["conta"], 0);
  const valueColumn = findColumnByHeader(csv.headers, ["valor"], 13);
  const counts = new Map(Array.from({ length: 8 }, (_, index) => [String(index + 1), 0]));

  if (accountColumn && valueColumn) {
    csv.rows.forEach((row) => {
      const account = String(row[accountColumn] ?? "").replace(/\D/g, "");
      const accountClass = account[0] ?? "";
      const value = parseFiscalNumber(String(row[valueColumn] ?? ""));
      if (!counts.has(accountClass) || value === null || value === 0) return;
      counts.set(accountClass, (counts.get(accountClass) ?? 0) + 1);
    });
  }

  const classes: AccountClassCoverageValidation["classes"] = [...counts].map(([accountClass, nonZeroRows]) => ({
    accountClass,
    group: Number(accountClass) <= 4
      ? "Patrimonial"
      : Number(accountClass) <= 6
        ? "Orçamentária"
        : "Controle",
    nonZeroRows,
  }));
  const missingClasses = classes.filter((item) => item.nonZeroRows === 0).map((item) => item.accountClass);

  return {
    accountColumn,
    valueColumn,
    classes,
    missingClasses,
    passed: Boolean(accountColumn && valueColumn) && missingClasses.length === 0,
  };
}

function formatBalance(value: number | null, nature: string) {
  if (value === null) return "-";

  const formatted = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

  return nature ? `${formatted} (${nature})` : formatted;
}

function balanceDifferenceLabel(reason: MscBalanceDifference["reason"]) {
  const labels: Record<MscBalanceDifference["reason"], string> = {
    different_value: "Valor diferente",
    different_nature: "Natureza diferente",
    missing_ending: "Saldo final ausente",
    missing_beginning: "Saldo inicial ausente",
  };

  return labels[reason];
}

function validateAccountNatures(csv: ParsedCsv, pcaspAccounts: PcaspAccount[]) {
  const accountColumn = findColumnByHeader(csv.headers, ["conta"], 0);
  const valueColumn = findColumnByHeader(csv.headers, ["valor"], 13);
  const valueTypeColumn = findColumnByHeader(csv.headers, ["tipo_valor", "tipovalor"], 14);
  const natureColumn = findColumnByHeader(csv.headers, ["natureza_valor", "naturezavalor"], 15);
  const emptyResult: AccountNatureValidation = {
    rows: [],
    checked: 0,
    withoutNature: 0,
    ignoredType: 0,
    ignoredZeroBalance: 0,
    inverted: 0,
    correct: 0,
    columns: {
      account: accountColumn,
      value: valueColumn,
      valueType: valueTypeColumn,
      nature: natureColumn,
    },
  };

  if (!accountColumn || pcaspAccounts.length === 0) {
    return emptyResult;
  }

  const pcaspIndex = buildPcaspIndex(pcaspAccounts);
  let checked = 0;
  let withoutNature = 0;
  let ignoredType = 0;
  let ignoredZeroBalance = 0;
  let inverted = 0;
  let correct = 0;
  const rows: AccountNatureIssue[] = [];

  for (const [index, row] of csv.rows.entries()) {
    const account = row[accountColumn] ?? "";
    const valueType = row[valueTypeColumn] ?? "";

    // D1_00021 trata exclusivamente das contas do ativo: classe/nível 1 do PCASP.
    if (!account.replace(/\D/g, "").startsWith("1")) {
      continue;
    }

    if (normalizeSearch(valueType) !== "ending_balance") {
      ignoredType += 1;
      continue;
    }

    const balance = parseFiscalNumber(row[valueColumn] ?? "");
    if (balance === 0) {
      ignoredZeroBalance += 1;
      continue;
    }

    const actualNature = extractNature(row[natureColumn] ?? "");

    if (!actualNature) {
      withoutNature += 1;
      continue;
    }

    const pcaspAccount = findPcaspAccount(account, pcaspIndex);
    const expectedNature = pcaspAccount?.balanceNature ?? "Nao encontrada no PCASP";
    const status = pcaspAccount && acceptsNature(pcaspAccount.normalizedNature, actualNature)
      ? "Correto"
      : "Invertido";

    checked += 1;

    if (status === "Invertido") inverted += 1;
    if (status === "Correto") correct += 1;

    rows.push({
      rowNumber: Number(row.__rowNumber) || index + 3,
      account,
      comparisonKey: `${account} + ending_balance`,
      accountClass: pcaspAccount?.account ?? "-",
      expectedNature,
      actualNature,
      valueType,
      status,
    });
  }

  return {
    rows,
    checked,
    withoutNature,
    ignoredType,
    ignoredZeroBalance,
    inverted,
    correct,
    columns: {
      account: accountColumn,
      value: valueColumn,
      valueType: valueTypeColumn,
      nature: natureColumn,
    },
  };
}

function buildPcaspIndex(accounts: PcaspAccount[]) {
  return new Map(accounts.map((account) => [normalizeAccountCode(account.account), account]));
}

function findPcaspAccount(account: string, index: Map<string, PcaspAccount>) {
  const normalized = normalizeAccountCode(account);
  if (!normalized) return null;

  const exact = index.get(normalized);
  if (exact) return exact;

  for (let length = normalized.length - 1; length > 0; length -= 1) {
    const parent = normalized.slice(0, length).padEnd(normalized.length, "0");
    const match = index.get(parent);
    if (match) return match;
  }

  return null;
}

function acceptsNature(expected: PcaspAccount["normalizedNature"], actual: string) {
  if (expected === "D/C") return actual === "D" || actual === "C";
  return expected === actual;
}

function normalizeAccountCode(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? digits.padStart(9, "0") : "";
}

function findColumnByHeader(headers: string[], candidates: string[], fallbackIndex: number) {
  const normalizedCandidates = new Set(candidates.map(normalizeHeaderKey));
  return headers.find((header) => normalizedCandidates.has(normalizeHeaderKey(header))) ?? headers[fallbackIndex] ?? "";
}

function normalizeHeaderKey(value: string) {
  return normalizeSearch(value).replace(/[^a-z0-9]/g, "");
}

function parseFiscalNumber(value: string) {
  const cleaned = value.trim().replace(/\s/g, "");
  if (!cleaned) return null;

  const normalized = cleaned.includes(",")
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function extractNature(value: string) {
  const normalized = normalizeSearch(value);

  if (normalized === "d" || normalized.startsWith("d ") || normalized.includes("deved")) return "D";
  if (normalized === "c" || normalized.startsWith("c ") || normalized.includes("cred")) return "C";

  const token = normalized.match(/(?:^|[^a-z0-9])([dc])(?:[^a-z0-9]|$)/);
  if (token?.[1] === "d") return "D";
  if (token?.[1] === "c") return "C";

  return "";
}

function FilePanel({
  title,
  fileKind,
  fileName,
  parsedCsv,
  selectedKey,
  onFile,
  onKeyChange,
}: {
  title: string;
  fileKind: "csv" | "xls";
  fileName: string;
  parsedCsv: ParsedCsv;
  selectedKey: string;
  onFile: (file: File) => void;
  onKeyChange: (value: string) => void;
}) {
  return (
    <section className="panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {fileName || `Selecione um arquivo ${fileKind === "xls" ? "XLS/XLSX" : "CSV ou ZIP"}`}
          </p>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
          {parsedCsv.delimiter === "\t" ? "tab" : parsedCsv.delimiter}
        </span>
      </div>

      <label className="mt-4 block">
        <span className="sr-only">Selecionar {title}</span>
        <input
          className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-cyan-700 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-cyan-800"
          type="file"
          accept={fileKind === "xls" ? ".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : ".csv,.zip,text/csv,application/zip,application/x-zip-compressed"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
          }}
        />
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <DataPoint label="Colunas" value={parsedCsv.headers.length} />
        <DataPoint label="Linhas" value={parsedCsv.rows.length} />
        <div className="sm:col-span-1">
          <label className="text-xs font-semibold uppercase text-slate-500">Chave</label>
          <SelectField value={selectedKey} options={parsedCsv.headers} onChange={onKeyChange} />
        </div>
      </div>
    </section>
  );
}

function SelectField({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <select className="form-field" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Selecione</option>
      {options.length === 0 && <option value="">Sem colunas</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function DataPoint({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function RreoHomologationDetails({ evaluation }: { evaluation: RreoTimelinessEvaluation }) {
  return <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
    <div className="grid gap-4 bg-slate-50 p-4 sm:grid-cols-3"><div><p className="text-xs font-semibold uppercase text-slate-500">Exercício</p><p className="mt-1 text-xl font-semibold">{evaluation.exercise}</p></div><div><p className="text-xs font-semibold uppercase text-slate-500">Homologados</p><p className="mt-1 text-xl font-semibold">{evaluation.timelyPeriods} / 6</p></div><div><p className="text-xs font-semibold uppercase text-slate-500">Pontuação</p><p className="mt-1 text-xl font-semibold">{evaluation.points.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} / 1</p></div></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-y border-slate-200 bg-cyan-50 text-xs uppercase text-slate-600"><tr><th className="px-4 py-3">Bimestre</th><th className="px-4 py-3">Homologação</th><th className="px-4 py-3">Resultado</th><th className="px-4 py-3 text-right">Pontos</th></tr></thead><tbody className="divide-y divide-slate-100">{evaluation.periods.map((period) => <tr key={period.period} className="even:bg-slate-50"><td className="px-4 py-3 font-semibold">{period.period}º</td><td className="px-4 py-3">{period.deliveryDate ? formatDateOnly(period.deliveryDate) : "Não localizada"}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${period.delivered ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>{period.delivered ? "Homologado" : "Não homologado"}</span></td><td className="px-4 py-3 text-right font-semibold">{period.points.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}</td></tr>)}</tbody></table></div>
    <p className="border-t border-slate-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">Cada RREO homologado vale 1/6 de ponto, independentemente da data em que ocorreu a homologação.</p>
  </div>;
}

function RreoTimelinessDetails({ evaluation }: { evaluation: RreoTimelinessEvaluation }) {
  return <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
    <div className="grid gap-4 bg-slate-50 p-4 sm:grid-cols-4">
      <div><p className="text-xs font-semibold uppercase text-slate-500">Exercício</p><p className="mt-1 text-xl font-semibold">{evaluation.exercise}</p></div>
      <div><p className="text-xs font-semibold uppercase text-slate-500">Tempestivos</p><p className="mt-1 text-xl font-semibold">{evaluation.timelyPeriods}</p></div>
      <div><p className="text-xs font-semibold uppercase text-slate-500">No prazo</p><p className="mt-1 text-xl font-semibold">{evaluation.provisionalPeriods}</p></div>
      <div><p className="text-xs font-semibold uppercase text-slate-500">Pontuação</p><p className="mt-1 text-xl font-semibold">{evaluation.points.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} / 1</p></div>
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-y border-slate-200 bg-cyan-50 text-xs uppercase text-slate-600"><tr><th className="px-4 py-3">Bimestre</th><th className="px-4 py-3">Prazo legal</th><th className="px-4 py-3">Homologação</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Pontos</th></tr></thead><tbody className="divide-y divide-slate-100">{evaluation.periods.map((period) => <tr key={period.period} className="even:bg-slate-50"><td className="px-4 py-3 font-semibold">{period.period}º</td><td className="px-4 py-3">{formatDateOnly(period.deadline)}</td><td className="px-4 py-3">{period.deliveryDate ? formatDateOnly(period.deliveryDate) : "Não localizado"}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${period.timely ? "bg-emerald-100 text-emerald-800" : period.provisional ? "bg-cyan-100 text-cyan-800" : "bg-rose-100 text-rose-800"}`}>{period.timely ? "Tempestivo" : period.provisional ? "No prazo — provisório" : "Intempestivo/ausente"}</span></td><td className="px-4 py-3 text-right font-semibold">{period.points.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}</td></tr>)}</tbody></table></div>
    <p className="border-t border-slate-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">Cada bimestre vale 1/6 de ponto. Períodos ainda não enviados continuam pontuando enquanto o respectivo prazo estiver aberto e perdem a parcela após o vencimento sem homologação tempestiva.</p>
  </div>;
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function DcaTimelinessDetails({ evaluation }: { evaluation: DcaTimelinessEvaluation }) {
  return <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
    <div className="grid gap-4 bg-slate-50 p-4 sm:grid-cols-5">
      <div><p className="text-xs font-semibold uppercase text-slate-500">Exercício</p><p className="mt-1 text-xl font-semibold">{evaluation.exercise}</p></div>
      <div><p className="text-xs font-semibold uppercase text-slate-500">Prazo</p><p className="mt-1 font-semibold">{formatDateOnly(evaluation.deadline)}</p></div>
      <div><p className="text-xs font-semibold uppercase text-slate-500">Homologação</p><p className="mt-1 font-semibold">{evaluation.deliveryDate ? formatDateOnly(evaluation.deliveryDate) : "Não localizada"}</p></div>
      <div><p className="text-xs font-semibold uppercase text-slate-500">Resultado</p><p className={`mt-1 font-semibold ${evaluation.points ? "text-emerald-700" : "text-rose-700"}`}>{evaluation.timely ? "Tempestiva" : evaluation.provisional ? "No prazo — pontuação provisória" : "Intempestiva/ausente"}</p></div>
      <div><p className="text-xs font-semibold uppercase text-slate-500">Pontuação</p><p className="mt-1 text-xl font-semibold">{evaluation.points} / 1</p></div>
    </div>
    <p className="border-t border-slate-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">A DCA deve estar homologada até 30 de abril do ano subsequente. O item mantém 1 ponto enquanto o prazo estiver aberto e perde a pontuação se o prazo for encerrado sem homologação tempestiva.</p>
  </div>;
}

function RgfExecutiveTimelinessDetails({ evaluation }: { evaluation: RgfExecutiveTimelinessEvaluation }) {
  return <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
    <div className="grid gap-4 bg-slate-50 p-4 sm:grid-cols-4"><div><p className="text-xs font-semibold uppercase text-slate-500">Exercício</p><p className="mt-1 text-xl font-semibold">{evaluation.exercise}</p></div><div><p className="text-xs font-semibold uppercase text-slate-500">Tempestivos</p><p className="mt-1 text-xl font-semibold">{evaluation.timelyPeriods}</p></div><div><p className="text-xs font-semibold uppercase text-slate-500">No prazo</p><p className="mt-1 text-xl font-semibold">{evaluation.provisionalPeriods}</p></div><div><p className="text-xs font-semibold uppercase text-slate-500">Pontuação</p><p className="mt-1 text-xl font-semibold">{evaluation.points.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} / 1</p></div></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-y border-slate-200 bg-cyan-50 text-xs uppercase text-slate-600"><tr><th className="px-4 py-3">Quadrimestre</th><th className="px-4 py-3">Prazo</th><th className="px-4 py-3">Homologação</th><th className="px-4 py-3">Resultado</th><th className="px-4 py-3 text-right">Pontos</th></tr></thead><tbody className="divide-y divide-slate-100">{evaluation.periods.map((period) => <tr key={period.period} className="even:bg-slate-50"><td className="px-4 py-3 font-semibold">{period.period}º</td><td className="px-4 py-3">{formatDateOnly(period.deadline)}</td><td className="px-4 py-3">{period.deliveryDate ? formatDateOnly(period.deliveryDate) : "Não localizada"}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${period.timely ? "bg-emerald-100 text-emerald-800" : period.provisional ? "bg-cyan-100 text-cyan-800" : "bg-rose-100 text-rose-800"}`}>{period.timely ? "Tempestivo" : period.provisional ? "No prazo — provisório" : "Intempestivo/ausente"}</span></td><td className="px-4 py-3 text-right font-semibold">{period.points.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}</td></tr>)}</tbody></table></div>
    <p className="border-t border-slate-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">Cada quadrimestre vale 1/3 de ponto. A parcela permanece pontuando enquanto seu prazo estiver aberto e é perdida após o vencimento sem homologação tempestiva.</p>
  </div>;
}

function DimensionDashboard({
  dimension,
  label,
  rules,
  checksByRule,
  periodicityByRule,
  loading,
  automaticRuleCompleted,
  automaticResultsByRule,
  rreoTimeliness,
  rreoHomologation,
  dcaTimeliness,
  rgfExecutiveTimeliness,
  rgfLegislativeTimeliness,
  onSelectRule,
}: {
  dimension: number;
  label: string;
  rules: StoredComparisonRule[];
  checksByRule: Map<string, Map<number, ComparisonRuleCheck>>;
  periodicityByRule: Map<string, PeriodicityKey>;
  loading: boolean;
  automaticRuleCompleted: boolean;
  automaticResultsByRule: Map<string, boolean>;
  rreoTimeliness: RreoTimelinessEvaluation | null;
  rreoHomologation: RreoTimelinessEvaluation | null;
  dcaTimeliness: DcaTimelinessEvaluation | null;
  rgfExecutiveTimeliness: RgfExecutiveTimelinessEvaluation | null;
  rgfLegislativeTimeliness: RgfExecutiveTimelinessEvaluation | null;
  onSelectRule: (code: string) => void;
}) {
  const palette = ["#075985", "#0369a1", "#0284c7", "#1d4ed8"];
  const accent = palette[dimension - 1] ?? palette[0];
  const items = rules.map((rule) => {
    const periodicityKey = periodicityByRule.get(rule.code) ?? inferRulePeriodicity(rule.item);
    const periodicity = getRulePeriodicity(periodicityKey);
    const saved = checksByRule.get(rule.code);
    const completedPeriods = saved
      ? [...saved.values()].filter((check) => Boolean(check.completedDate) || check.quantity != null).length
      : 0;
    const normalizedStatus = normalizeSearch(rule.status);
    let status: DimensionItemStatus = "pending";

    if (rule.code === "D1_00001" && rreoHomologation) status = rreoHomologation.classification;
    else if (rule.code === "D1_00002" && dcaTimeliness) status = dcaTimeliness.classification;
    else if (rule.code === "D1_00003" && rgfExecutiveTimeliness) status = rgfExecutiveTimeliness.classification;
    else if (rule.code === "D1_00004" && rgfLegislativeTimeliness) status = rgfLegislativeTimeliness.classification;
    else if (rule.code === "D1_00006" && rreoTimeliness) status = rreoTimeliness.classification;
    else if (periodicityKey === "not_applicable" || normalizedStatus.includes("nao aplic")) status = "not_applicable";
    else if (rule.code === "D1_00028" && automaticResultsByRule.get(rule.code) === true) status = "partial";
    else if (automaticResultsByRule.get(rule.code) === true || (rule.code === "D1_00021" && automaticRuleCompleted)) status = "total";
    else if (completedPeriods > 0 && completedPeriods >= periodicity.periods) status = "total";
    else if (completedPeriods > 0) status = "partial";
    else if (normalizedStatus.includes("realiz") || normalizedStatus.includes("conclu") || normalizedStatus.includes("pontuou total")) status = "total";
    else if (normalizedStatus.includes("parcial")) status = "partial";

    const points = rule.code === "D1_00001" && rreoHomologation
      ? rreoHomologation.points
      : rule.code === "D1_00002" && dcaTimeliness
        ? dcaTimeliness.points
        : rule.code === "D1_00003" && rgfExecutiveTimeliness
          ? rgfExecutiveTimeliness.points
          : rule.code === "D1_00004" && rgfLegislativeTimeliness
            ? rgfLegislativeTimeliness.points
            : rule.code === "D1_00006" && rreoTimeliness
              ? rreoTimeliness.points
        : status === "total" ? 1 : status === "partial" ? 0.5 : 0;
    return { rule, status, points };
  });
  const counts = items.reduce<Record<DimensionItemStatus, number>>((totals, item) => {
    totals[item.status] += 1;
    return totals;
  }, { total: 0, partial: 0, pending: 0, not_applicable: 0 });
  const applicable = Math.max(items.length - counts.not_applicable, 0);
  const earnedPoints = items.reduce((sum, item) => sum + item.points, 0);
  const progress = applicable ? Math.round((earnedPoints / applicable) * 100) : 0;
  const totalForChart = Math.max(items.length, 1);
  const totalEnd = (counts.total / totalForChart) * 100;
  const partialEnd = totalEnd + (counts.partial / totalForChart) * 100;
  const pendingEnd = partialEnd + (counts.pending / totalForChart) * 100;
  const chart = `conic-gradient(#075985 0 ${totalEnd}%, #38bdf8 ${totalEnd}% ${partialEnd}%, #2563eb ${partialEnd}% ${pendingEnd}%, #cbd5e1 ${pendingEnd}% 100%)`;
  const statusStyle: Record<DimensionItemStatus, string> = {
    total: "border-sky-800 bg-sky-800 text-white",
    partial: "border-sky-400 bg-sky-100 text-sky-900",
    pending: "border-blue-500 bg-white text-blue-700",
    not_applicable: "border-slate-300 bg-slate-100 text-slate-500",
  };

  return (
    <section className="panel mt-6 overflow-hidden" aria-labelledby={`dimension-${dimension}-title`}>
      <div className="px-5 py-5 text-white sm:px-6" style={{ background: `linear-gradient(115deg, ${accent}, #172554)` }}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">Visão geral do checklist</p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div><h2 id={`dimension-${dimension}-title`} className="text-2xl font-semibold">{label}</h2><p className="mt-1 text-sm text-white/75">Acompanhe o que já foi ajustado e priorize os itens pendentes.</p></div>
          <p className="text-sm font-semibold">{progress}% de avanço</p>
        </div>
      </div>
      {loading ? <p className="p-8 text-center text-sm text-slate-500">Carregando indicadores…</p> : (
        <div className="p-5 sm:p-6">
          <div className="grid gap-5 xl:grid-cols-[260px_1fr]">
            <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 p-5">
              <div className="grid h-44 w-44 place-items-center rounded-full" style={{ background: chart }} aria-label={`${progress}% de avanço`}>
                <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center shadow-inner"><div><strong className="block text-3xl text-slate-950">{progress}%</strong><span className="text-xs font-medium text-slate-500">avanço geral</span></div></div>
              </div>
              <p className="mt-4 text-sm font-medium text-slate-600">{items.length} itens avaliados</p>
            </div>
            <div className="grid content-start gap-3 sm:grid-cols-2">
              <DashboardMetric label="Pontuou total" value={counts.total} tone="deepBlue" />
              <DashboardMetric label="Pontuou parcial" value={counts.partial} tone="sky" />
              <DashboardMetric label="Ainda não pontuou" value={counts.pending} tone="blue" />
              <DashboardMetric label="Não aplicável" value={counts.not_applicable} tone="slate" />
              <DashboardMetric label="Pontuação acumulada" value={Number(earnedPoints.toFixed(4))} tone="deepBlue" />
            </div>
          </div>
          <div className="mt-7 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-950">Mapa dos itens</h3><p className="mt-1 text-sm text-slate-500">Clique em um item para abrir seus detalhes.</p></div><span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700">{counts.pending} ajustes pendentes</span></div>
          <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7 md:grid-cols-9 xl:grid-cols-12">
            {items.map(({ rule, status }) => <button key={rule.code} type="button" onClick={() => onSelectRule(rule.code)} title={`${rule.code} — ${rule.item}`} className={`relative min-h-12 rounded-md border px-1 py-2 text-xs font-bold transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 ${statusStyle[status]}`}>{Number(rule.code.split("_")[1])}<span className="sr-only">: {rule.item}</span>{status === "not_applicable" && <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-2xl font-light text-sky-700/70">×</span>}</button>)}
          </div>
        </div>
      )}
    </section>
  );
}

function DashboardMetric({ label, value, tone }: { label: string; value: number; tone: "deepBlue" | "sky" | "blue" | "slate" }) {
  const styles = { deepBlue: "border-sky-200 bg-sky-50 text-sky-900", sky: "border-cyan-200 bg-cyan-50 text-cyan-800", blue: "border-blue-200 bg-blue-50 text-blue-800", slate: "border-slate-200 bg-slate-50 text-slate-700" };
  return <div className={`rounded-xl border p-4 ${styles[tone]}`}><p className="text-xs font-semibold uppercase tracking-wide opacity-75">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>;
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose" | "slate";
}) {
  const styles = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    rose: "border-rose-200 bg-rose-50 text-rose-800",
    slate: "border-slate-200 bg-white text-slate-800",
  };

  return (
    <div className={`rounded-lg border px-4 py-3 shadow-sm ${styles[tone]}`}>
      <p className="text-xs font-semibold uppercase opacity-70">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: "ok" | "different" | "missing-target" | "missing-source" }) {
  const styles = {
    ok: "bg-emerald-100 text-emerald-800",
    different: "bg-amber-100 text-amber-800",
    "missing-target": "bg-rose-100 text-rose-800",
    "missing-source": "bg-slate-100 text-slate-700",
  };

  return (
    <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>
      {statusLabel(status)}
    </span>
  );
}
