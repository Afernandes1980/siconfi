export type OfficialFiscalDocument = {
  id: string;
  title: string;
  report: "RREO" | "RGF";
  kind: "validation" | "instructions";
  exercise: 2026;
  fileName: string;
  officialPath: string;
};

export type OfficialFiscalRule = {
  code: string;
  report: "RREO" | "RGF" | "RREO/RGF";
  category: "estrutura" | "preenchimento" | "numerico" | "percentual" | "cruzamento";
  severity: "erro" | "aviso";
  description: string;
  sourceDocumentIds: string[];
};

export const OFFICIAL_FISCAL_PACKAGE_LABEL = "Pacote oficial Siconfi RREO/RGF 2026";

export const OFFICIAL_FISCAL_DOCUMENTS: OfficialFiscalDocument[] = [
  {
    id: "rreo-validacao-2026",
    title: "Regras de Validacao RREO 2026",
    report: "RREO",
    kind: "validation",
    exercise: 2026,
    fileName: "2026_Regras_de_Validacao_RREO.pdf",
    officialPath:
      "Siconfi > Area Publica > Instrucoes e Guias de Preenchimento > Exercicio de 2026 > Regras de Validacao > RREO",
  },
  {
    id: "rgf-validacao-2026",
    title: "Regras de Validacao RGF 2026",
    report: "RGF",
    kind: "validation",
    exercise: 2026,
    fileName: "2026_Regras_de_Validacao_RGF.pdf",
    officialPath:
      "Siconfi > Area Publica > Instrucoes e Guias de Preenchimento > Exercicio de 2026 > Regras de Validacao > RGF",
  },
  {
    id: "rreo-instrucoes-2026",
    title: "Regras Gerais e Instrucoes de Preenchimento RREO 2026",
    report: "RREO",
    kind: "instructions",
    exercise: 2026,
    fileName: "2026_Regras_Gerais_Instrucoes_RREO.pdf",
    officialPath:
      "Siconfi > Area Publica > Instrucoes e Guias de Preenchimento > Exercicio de 2026 > Regras Gerais e Instrucoes de Preenchimento > RREO",
  },
  {
    id: "rgf-instrucoes-2026",
    title: "Regras Gerais e Instrucoes de Preenchimento RGF 2026",
    report: "RGF",
    kind: "instructions",
    exercise: 2026,
    fileName: "2026_Regras_Gerais_Instrucoes_RGF.pdf",
    officialPath:
      "Siconfi > Area Publica > Instrucoes e Guias de Preenchimento > Exercicio de 2026 > Regras Gerais e Instrucoes de Preenchimento > RGF",
  },
];

export const OFFICIAL_FISCAL_RULES: OfficialFiscalRule[] = [
  {
    code: "SICONFI-2026-EST-001",
    report: "RREO/RGF",
    category: "estrutura",
    severity: "erro",
    description:
      "O arquivo Fiscal deve estar estruturado com cabecalho unico, colunas identificaveis e linhas de dados preenchidas.",
    sourceDocumentIds: [
      "rreo-validacao-2026",
      "rgf-validacao-2026",
      "rreo-instrucoes-2026",
      "rgf-instrucoes-2026",
    ],
  },
  {
    code: "SICONFI-2026-PRE-001",
    report: "RREO/RGF",
    category: "preenchimento",
    severity: "erro",
    description:
      "Campos obrigatorios do demonstrativo, periodo, ente, conta, linha, coluna ou valor nao podem ficar vazios quando presentes no leiaute importado.",
    sourceDocumentIds: [
      "rreo-validacao-2026",
      "rgf-validacao-2026",
      "rreo-instrucoes-2026",
      "rgf-instrucoes-2026",
    ],
  },
  {
    code: "SICONFI-2026-NUM-001",
    report: "RREO/RGF",
    category: "numerico",
    severity: "erro",
    description:
      "Campos monetarios, saldos, despesas, receitas, totais, limites e resultados devem conter numeros validos no formato importado.",
    sourceDocumentIds: ["rreo-validacao-2026", "rgf-validacao-2026"],
  },
  {
    code: "SICONFI-2026-PCT-001",
    report: "RREO/RGF",
    category: "percentual",
    severity: "erro",
    description:
      "Campos percentuais devem conter numeros validos; quando representam percentuais usuais do demonstrativo, valores absolutos acima de 100 sao destacados.",
    sourceDocumentIds: ["rreo-validacao-2026", "rgf-validacao-2026"],
  },
  {
    code: "SICONFI-2026-CRZ-001",
    report: "RREO/RGF",
    category: "cruzamento",
    severity: "aviso",
    description:
      "Comparacoes oficiais de igualdade, somatorio, diferenca, preenchimento obrigatorio/vedado e validacoes percentuais devem orientar a conferencia entre anexos e abas.",
    sourceDocumentIds: ["rreo-validacao-2026", "rgf-validacao-2026"],
  },
];
