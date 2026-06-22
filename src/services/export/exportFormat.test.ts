import { describe, expect, it } from "vitest";
import { ExportFormat, isExportFormat, parseExportFormat } from "./exportFormat";

describe("ExportFormat", () => {
  it("recognizes export formats", () => {
    expect(isExportFormat(ExportFormat.Pdf)).toBe(true);
    expect(parseExportFormat("csv")).toBe(ExportFormat.Csv);
    expect(parseExportFormat("pdf")).toBe(ExportFormat.Pdf);
    expect(parseExportFormat("unknown")).toBe(ExportFormat.Pdf);
  });
});
