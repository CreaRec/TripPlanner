import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const pdf = vi.fn().mockResolvedValue(Buffer.from("pdf-bytes"));
  const setContent = vi.fn().mockResolvedValue(undefined);
  const newPage = vi.fn().mockResolvedValue({ setContent, pdf });
  const close = vi.fn().mockResolvedValue(undefined);
  const launch = vi.fn().mockResolvedValue({ newPage, close });
  const writeFileSync = vi.fn();
  return { launch, newPage, setContent, pdf, close, writeFileSync };
});

vi.mock("node:fs", () => ({
  writeFileSync: mocks.writeFileSync,
}));

vi.mock("puppeteer-core", () => ({
  default: { launch: mocks.launch },
}));

vi.mock("../config", () => ({
  config: { chromiumExecutablePath: "/usr/bin/chromium" },
}));

import { renderHtmlToPdf, resetPdfRenderLock } from "./gmailPdf";

describe("renderHtmlToPdf", () => {
  beforeEach(() => {
    resetPdfRenderLock();
    mocks.launch.mockClear();
    mocks.newPage.mockClear();
    mocks.setContent.mockClear();
    mocks.pdf.mockClear();
    mocks.close.mockClear();
    mocks.writeFileSync.mockClear();
  });

  it("renders html through puppeteer and writes the pdf file", async () => {
    await renderHtmlToPdf("<html><body>Hello</body></html>", "/tmp/email.pdf");

    expect(mocks.launch).toHaveBeenCalledWith({
      executablePath: "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    expect(mocks.setContent).toHaveBeenCalledWith("<html><body>Hello</body></html>", {
      waitUntil: "load",
      timeout: 30_000,
    });
    expect(mocks.pdf).toHaveBeenCalledWith({ format: "A4", printBackground: true });
    expect(mocks.writeFileSync).toHaveBeenCalledWith("/tmp/email.pdf", Buffer.from("pdf-bytes"));
    expect(mocks.close).toHaveBeenCalled();
  });
});
