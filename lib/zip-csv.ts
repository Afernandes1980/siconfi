import { strFromU8, unzipSync } from "fflate";
import { parseCsv, type ParsedCsv } from "@/lib/csv";

type ParseCsvOrZipOptions = {
  hasHeader?: boolean;
  headerRowIndex?: number;
  dataStartRowIndex?: number;
};

export async function parseCsvOrZip(
  file: File,
  options: ParseCsvOrZipOptions = {},
): Promise<{ parsed: ParsedCsv; importedName: string }> {
  if (!isZipFile(file)) {
    return {
      parsed: parseCsv(await file.text(), options),
      importedName: file.name,
    };
  }

  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const csvEntryName = Object.keys(entries)
    .filter((name) => !name.endsWith("/") && name.toLowerCase().endsWith(".csv"))
    .sort((left, right) => left.localeCompare(right, "pt-BR"))[0];

  if (!csvEntryName) {
    throw new Error("O arquivo ZIP nao contem nenhum CSV.");
  }

  return {
    parsed: parseCsv(strFromU8(entries[csvEntryName]), options),
    importedName: `${file.name} / ${csvEntryName}`,
  };
}

function isZipFile(file: File) {
  return file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}
