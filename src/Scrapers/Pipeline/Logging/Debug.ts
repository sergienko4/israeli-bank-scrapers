/**
 * Public logger API for the pipeline — `getDebug(import.meta.url)` and
 * `getDebugByName(name)` build deferred-resolve pino children that pick
 * up the bank's file destination after `setActiveBank` fires.
 *
 * This file is the cluster's outward facade; sibling files
 * ({@link ./BankContext.ts}, {@link ./RootLogger.ts},
 * {@link ./LoggerNaming.ts}, {@link ./ChildLoggerProxy.ts}) hold the
 * implementation. Pipeline consumers import the public logger
 * primitives from here; the `Types/Debug.ts` re-export shim that
 * bridged the Phase 12c move is now retired.
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
 * adapter is imported directly by the legacy scrapers (BaseScraper, Leumi,
 * Mizrahi, BeyahadBishvilha, …), conventionally as
 * `import { getDebugByName as getDebug }`, so their `module:` log values stay
 * verbatim without rewriting every call site to `import.meta.url`.
 *
 * Binding a string-name caller to {@link getDebug} instead is silent: both are
 * callable and both return a logger, so the only symptom is a `module:` field
 * derived from the caller's own path. Keep the alias at the import.
 * @param name - Verbatim module name written into the `module:` log field.
 * @returns A pino-shaped logger that defers child creation.
 */
export function getDebugByName(name: string): Logger {
  return buildDeferredLogger(name);
}

export { getActiveLogContext, runWithBankContext } from './BankContext.js';
