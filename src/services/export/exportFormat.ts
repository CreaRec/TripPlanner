export enum ExportFormat {
  Pdf = "pdf",
  Csv = "csv",
}

export const EXPORT_FORMATS = Object.values(ExportFormat);

export function isExportFormat(value: unknown): value is ExportFormat {
  return (EXPORT_FORMATS as string[]).includes(String(value));
}

export function parseExportFormat(value: unknown): ExportFormat {
  return value === ExportFormat.Csv ? ExportFormat.Csv : ExportFormat.Pdf;
}
