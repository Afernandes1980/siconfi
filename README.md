# Siconfi

Aplicação web para análise do Ranking Municipal da STN. O sistema compara dados da Matriz com arquivos fiscais, aplica regras de validação de 2026 e verifica a natureza contábil das contas com base no PCASP Estendido.

## Tecnologias

- Next.js 16 com App Router e Turbopack.
- React 19 e TypeScript.
- Tailwind CSS 4.
- SQLite por meio do módulo nativo `node:sqlite`.
- SheetJS (`xlsx`) para leitura de arquivos XLS/XLSX.
- `fflate` para leitura de arquivos ZIP.

O projeto não usa SQL Server nem exige variáveis de ambiente na configuração atual.

## Funcionalidades

- Importação da **Matriz** em CSV ou ZIP contendo um CSV.
- Importação do arquivo **Fiscal** em XLS ou XLSX, incluindo múltiplas abas.
- Detecção automática de delimitadores CSV entre `;`, `,`, tabulação e `|`.
- Escolha das colunas-chave que relacionam a Matriz ao arquivo Fiscal.
- Mapeamento configurável de campos com as regras:
  - igualdade exata;
  - igualdade ignorando maiúsculas, minúsculas e acentos;
  - conteúdo parcial;
  - número com tolerância;
  - mesma data.
- Resumo de registros conferidos, divergentes e ausentes.
- Exportação do resultado da comparação para CSV.
- Validação estrutural e numérica dos arquivos fiscais DCA, RREO e RGF.
- Conferência de fórmulas fiscais com as regras de `data/fiscal-formulas-2026.json`.
- Validação da natureza das contas da Matriz com o PCASP Estendido 2026.
- Consulta e filtragem do checklist STN armazenado no SQLite.

## Requisitos

- Node.js 22 ou superior, necessário para o uso de `node:sqlite`.
- npm.

## Instalação e execução

Instale as dependências:

```bash
npm install
```

Inicie o ambiente de desenvolvimento:

```bash
npm run dev
```

A aplicação ficará disponível, por padrão, em [http://localhost:3000](http://localhost:3000).

Para gerar e executar a versão de produção:

```bash
npm run build
npm start
```

## Persistência local

Os dados persistidos ficam em `data/siconfi.sqlite`. O arquivo é criado automaticamente na primeira requisição às APIs da aplicação e não é versionado pelo Git.

O banco contém as seguintes tabelas:

- `comparison_rules`: checklist e regras de comparação importadas.
- `account_natures`: natureza padrão das classes contábeis; recebe automaticamente as classes 1 a 8.
- `msc_layout_sheets`: linhas brutas importadas do leiaute MSC.
- `pcasp_extended_2026`: contas e naturezas do PCASP Estendido 2026.
- `official_fiscal_documents`: metadados dos documentos fiscais oficiais.
- `official_fiscal_rules`: regras fiscais oficiais exibidas pela aplicação.

As tabelas e os índices são inicializados por `lib/rules-db.ts`. Os registros de natureza contábil e o pacote de regras fiscais oficiais são atualizados automaticamente durante essa inicialização.

Para recriar o banco do zero, pare a aplicação, remova manualmente `data/siconfi.sqlite` e execute novamente um comando de importação ou inicie a aplicação. Essa operação elimina todos os dados locais importados.

## Fórmulas fiscais de 2026

As fórmulas ficam no arquivo versionado `data/fiscal-formulas-2026.json`; elas não são armazenadas no SQLite. O módulo `lib/fiscal-validation.ts` carrega esse arquivo diretamente durante a compilação e seleciona as regras de acordo com o relatório detectado: DCA, RREO ou RGF.

Cada regra possui os campos:

```json
{
  "report": "RREO",
  "sourceFile": "arquivo-de-origem.xls",
  "sheetName": "RREO-Anexo 01",
  "address": "B21",
  "formula": "+B22+B23"
}
```

Ao atualizar o JSON, mantenha a propriedade raiz `rules` e a mesma estrutura dos registros.

## Importação do checklist STN

Para importar ou atualizar as regras de comparação:

```bash
npm run import:rules
```

Sem um caminho explícito, o script procura na pasta `Downloads` do usuário o primeiro arquivo cujo nome corresponda a `checklist_STN_dimensoes- 2025*.xlsx`.

Também é possível informar o arquivo manualmente:

```bash
npm run import:rules -- "C:\caminho\checklist.xlsx"
```

A importação é idempotente pelo código da regra: registros existentes são atualizados e novos registros são inseridos.

## Importação do leiaute MSC e PCASP

O importador do leiaute MSC exige o caminho de um arquivo XLS/XLSX:

```bash
npm run import:msc-layout -- "C:\caminho\Leiaute_MSC_2026.xlsx"
```

Todas as linhas das planilhas são armazenadas em `msc_layout_sheets`. Quando existe uma aba cujo nome normalizado seja `PCASPEstendido2026`, suas contas também são inseridas ou atualizadas em `pcasp_extended_2026`.

Esse passo é necessário para que a validação de natureza contábil encontre as contas oficiais do PCASP.

## Fluxo de uso

1. Importe o checklist STN e o leiaute MSC/PCASP, caso o banco ainda não esteja populado.
2. Execute a aplicação com `npm run dev`.
3. Selecione a Matriz em CSV ou ZIP.
4. Selecione o arquivo Fiscal em XLS ou XLSX.
5. Escolha as chaves que relacionam os arquivos.
6. Adicione os mapeamentos e as regras de comparação desejadas.
7. Analise as validações fiscais, as naturezas contábeis e o resultado comparativo.
8. Exporte as divergências para CSV quando necessário.

## Estrutura principal

```text
app/
  api/                         APIs de regras, naturezas e contas PCASP
components/
  CsvComparator.tsx            Interface e fluxo principal da aplicação
data/
  fiscal-formulas-2026.json    Fórmulas fiscais versionadas
  siconfi.sqlite               Banco local gerado, ignorado pelo Git
lib/
  comparison.ts                Regras de comparação
  csv.ts                       Leitura e geração de CSV
  fiscal-validation.ts         Validações fiscais e de fórmulas
  rules-db.ts                  Esquema, consultas e carga inicial do SQLite
  spreadsheet.ts               Leitura dos arquivos fiscais XLS/XLSX
  zip-csv.ts                   Extração e leitura de CSV dentro de ZIP
scripts/
  import-comparison-rules.mjs  Importação do checklist STN
  import-msc-layout.mjs        Importação do leiaute MSC e PCASP
```

## APIs internas

- `GET /api/comparison-rules`: regras importadas, resumo e pacote fiscal oficial.
- `GET /api/account-natures`: natureza padrão por classe contábil.
- `GET /api/pcasp-accounts`: contas do PCASP Estendido 2026.

As APIs usam o runtime Node.js porque acessam o SQLite local.
