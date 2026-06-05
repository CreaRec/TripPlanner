import { writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { config } from "../config";

const PDF_RENDER_TIMEOUT_MS = 30_000;

let renderChain: Promise<void> = Promise.resolve();

function withPdfRenderLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = renderChain.then(fn);
  renderChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function renderHtmlToPdf(html: string, outputPath: string): Promise<void> {
  return withPdfRenderLock(async () => {
    const browser = await puppeteer.launch({
      executablePath: config.chromiumExecutablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: "load",
        timeout: PDF_RENDER_TIMEOUT_MS,
      });
      const pdf = await page.pdf({
        format: "A4",
        printBackground: true,
      });
      writeFileSync(outputPath, pdf);
    } finally {
      await browser.close();
    }
  });
}

/** @internal Test helper */
export function resetPdfRenderLock(): void {
  renderChain = Promise.resolve();
}
