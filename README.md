# Siconfi

Aplicacao Next.js para comparar dois arquivos CSV por mapeamentos configuraveis.

## Funcionalidades iniciais

- Upload de dois arquivos CSV.
- Deteccao automatica de delimitador entre `;`, `,`, tab e `|`.
- Regras/checklist STN salvas em SQLite.
- Escolha das colunas-chave que ligam o arquivo A ao arquivo B.
- Regras de comparacao por mapeamento:
  - Igual.
  - Igual ignorando maiusculas e acentos.
  - Contem.
  - Numero com tolerancia.
  - Mesma data.
- Resumo de registros conferidos, divergentes e ausentes.
- Exportacao do resultado em CSV.

## Rodando

```bash
npm install
npm run import:rules
npm run dev
```

O comando `npm run import:rules` procura automaticamente o arquivo
`checklist_STN_dimensoes- 2025*.xlsx` na pasta Downloads. Tambem e possivel
informar o caminho manualmente:

```bash
npm run import:rules -- "C:\caminho\arquivo.xlsx"
```
