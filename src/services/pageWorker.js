import { analyzeDrawingPage } from "@/services/pageAnalysisService";
import {isPdfCreditBalanceError} from '@/lib/pdfAnalysisErrors.mjs';

const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryable(error) {
  if (isPdfCreditBalanceError(error)) return false;
  const status = Number(error?.status);
  return RETRYABLE_STATUS_CODES.has(status) || /timeout|rate limit|temporar/i.test(error?.message || "");
}

export async function processPage(page, context = {}, { maxAttempts = 3 } = {}) {
  if(context.noAutomaticRetries)maxAttempts=1;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await analyzeDrawingPage({
        pageBytes: page.bytes,
        pageNumber: page.pageNumber,
        sourceFileName: context.sourceFileName,
        projectName: context.projectName,
        discipline: context.discipline,
      });

      return {
        success: true,
        pageNumber: page.pageNumber,
        result,
      };
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts || !isRetryable(error)) {
        break;
      }

      await wait(1200 * attempt);
    }
  }

  return {
    success: false,
    pageNumber: page.pageNumber,
    error: lastError?.message || "Page analysis failed.",
    status: Number(lastError?.status) || null,
    code: lastError?.code || null,
    type: lastError?.type || null,
    creditUnavailable: isPdfCreditBalanceError(lastError),
  };
}
