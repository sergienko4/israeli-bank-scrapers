/**
 * Per-run screenshot path builder. Produces `{bank}-{phase-step}-{ts}.png`
 * inside the trace-mode run folder
 * (`<RUNS_ROOT>/<run-stamp>/screenshots/`), where `ts` is captured when
 * the screenshot is taken. Bank comes from the caller (pipeline
 * context.companyId); timestamp is computed inline so every shot lands in
 * its own file even when a single phase takes several. Returns the empty
 * string when not in trace mode — callers must skip writing when path
 * length is 0 (no screenshot folder is created off-trace, gated centrally
 * by TraceConfig).
 */

import * as path from 'node:path';

import { getScreenshotDir } from './TraceConfig.js';

/** Bank slug from CompanyTypes (e.g. "pepper"). */
type BankSlug = string;
/** Phase-and-step descriptor set by the caller. */
type ScreenshotLabel = string;
/** Absolute Windows path where the PNG is written, or empty when off-trace. */
type ScreenshotPath = string;
/** 2-digit zero-padded numeric string (e.g. "04", "19"). */
type ZeroPadded2 = string;
/** Compact local timestamp formatted as "YYYYMMDD-HHMMSS". */
type CompactTimestamp = string;

/**
 * Zero-pad a 1- or 2-digit integer to width 2.
 * @param n - Integer to pad.
 * @returns Two-character string.
 */
function pad2(n: number): ZeroPadded2 {
  const s = String(n);
  return s.padStart(2, '0');
}

/**
 * Format the current timestamp as `YYYYMMDD-HHMMSS` (local time).
 * @returns Compact timestamp string.
 */
function nowStamp(): CompactTimestamp {
  const d = new Date();
  const fullYear = d.getFullYear();
  const year = String(fullYear);
  const month = d.getMonth() + 1;
  const monthStr = pad2(month);
  const day = d.getDate();
  const dayStr = pad2(day);
  const hours = d.getHours();
  const hoursStr = pad2(hours);
  const minutes = d.getMinutes();
  const minutesStr = pad2(minutes);
  const seconds = d.getSeconds();
  const secondsStr = pad2(seconds);
  const date = `${year}${monthStr}${dayStr}`;
  const time = `${hoursStr}${minutesStr}${secondsStr}`;
  return `${date}-${time}`;
}

/**
 * Resolve the on-disk screenshot path for this bank + diagnostic label.
 * Returns empty string when not in trace mode — callers (e.g. otpScreenshot)
 * must skip the page.screenshot() call when path length is 0.
 * @param bank - Bank slug (e.g. "pepper", "discount").
 * @param label - Phase-and-step descriptor ("login-post-before-traffic").
 * @returns Absolute path inside the trace-mode run folder, or empty string.
 */
export default function screenshotPath(bank: BankSlug, label: ScreenshotLabel): ScreenshotPath {
  const dir = getScreenshotDir();
  if (!dir) return '';
  const ts = nowStamp();
  const prefix = bank || 'screenshot';
  return path.join(dir, `${prefix}-${label}-${ts}.png`);
}

export { screenshotPath };
