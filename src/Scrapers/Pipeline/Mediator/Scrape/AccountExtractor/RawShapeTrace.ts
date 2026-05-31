/**
 * Raw-shape trace dump — best-effort logging helper that emits the
 * top-level keys of an API response that yielded zero account
 * records. Helps diagnose per-bank mapper gaps without stopping
 * the pipeline.
 *
 * The previous version logged up to 4096 chars of the raw JSON
 * payload — that leaked customer bank data into trace logs (account
 * numbers, balances, card IDs). Per CodeRabbit PR #277 review, we
 * now log ONLY the key names and a fixed `<redacted>` placeholder so
 * the log shape stays stable for parsers but no payload content
 * escapes. If you need to investigate a bank-specific structural
 * mismatch, attach a debugger or run the offline replay harness —
 * never widen this trace to include values.
 *
 * Sub-split out of AccountExtractor during Phase 5 to keep each
 * cluster file under the per-cluster max-lines:150 eff cap (master
 * plan pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import { getDebug } from '../../../Types/Debug.js';
import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';

const LOG = getDebug(import.meta.url);

/**
 * Trace-dump the raw response shape when extraction fails. Helps
 * diagnose bank-specific API formats (e.g. Hapoalim) without
 * stopping the pipeline. Emits ONLY top-level keys + a `<redacted>`
 * placeholder; never logs raw values (PII leak guard).
 * @param responseBody - The raw API body that yielded zero items.
 * @returns Always true (side-effect only).
 */
function traceRawShape(responseBody: ApiRecord): true {
  const topLevelKeys = Object.keys(responseBody);
  LOG.trace({
    message: 'extractAccountRecords: 0 items — raw body shape',
    topLevelKeys,
    preview: '<redacted>',
  });
  return true;
}

export default traceRawShape;
