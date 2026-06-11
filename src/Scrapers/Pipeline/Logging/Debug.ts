/**
 * Public logger API for the pipeline — `getDebug(import.meta.url)` and
 * `getDebugByName(name)` build deferred-resolve pino children that pick
 * up the bank's file destination after `setActiveBank` fires.
 *
 * This file is the cluster's outward facade; sibling files
 * ({@link ./BankContext.ts}, {@link ./RootLogger.ts},
 * {@link ./LoggerNaming.ts}, {@link ./ChildLoggerProxy.ts}) hold the
 * implementation. The legacy {@link ../Types/Debug.ts} import path stays
 * working via a thin re-export shim — every pipeline module continues
 * to import logger primitives from the same symbol names.
 */

import type { Logger } from 'pino';

import { buildDeferredLogger } from './ChildLoggerProxy.js';
import { deriveLogName } from './LoggerNaming.js';

export type ScraperLogger = Logger;

/**
 * Build a deferred-resolve child logger for a module. Capturing
 * `const LOG = getDebug(import.meta.url)` at module-load is safe: no
 * pino instance is built until the first method access on `LOG`. By
 * then `executePipeline` has called `setActiveBank` and `getLogFile()`
 * returns a real path, so the lazy root logger gets the file transport.
 *
 * Architectural Force: callers MUST pass `import.meta.url`. The logger
 * name is derived from the source filename — no manual name strings.
 * @param metaUrl - The caller's `import.meta.url`.
 * @returns A pino-shaped logger that defers child creation.
 */
export function getDebug(metaUrl: string): Logger {
  const name = deriveLogName(metaUrl);
  return buildDeferredLogger(name);
}

/**
 * Compatibility entry-point for legacy Common-side callers that pass a
 * manual module name string (e.g. `getDebug('leumi-scraper')`) or a
 * dynamic bank identifier (e.g. `getDebug(options.companyId)`). Pipeline
 * code MUST keep using {@link getDebug} with `import.meta.url`; this
 * adapter exists only so the Common shim at `src/Common/Debug.ts`
 * preserves verbatim `module:` log values during the Phase-3 unification
 * window, without forcing the legacy scrapers (BaseScraper, Leumi,
 * Mizrahi, BeyahadBishvilha, …) to migrate to `import.meta.url` in this
 * commit.
 * @param name - Verbatim module name written into the `module:` log field.
 * @returns A pino-shaped logger that defers child creation.
 */
export function getDebugByName(name: string): Logger {
  return buildDeferredLogger(name);
}

export { capTimeout, isMockTimingActive, MOCK_TIMEOUT_MS } from '../Types/MockTiming.js';
export { getActiveLogContext, runWithBankContext } from './BankContext.js';
