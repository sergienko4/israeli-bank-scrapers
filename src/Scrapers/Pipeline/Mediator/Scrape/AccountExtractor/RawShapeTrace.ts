/**
 * Raw-shape trace dump — best-effort logging helper that emits the
 * top-level keys and a JSON preview of an API response that yielded
 * zero account records. Helps diagnose per-bank mapper gaps without
 * stopping the pipeline.
 *
 * Sub-split out of AccountExtractor during Phase 5 to keep each
 * cluster file under the per-cluster max-lines:150 eff cap (master
 * plan pipeline-decoupling-master-2026-05-28 / phase-5).
 */

import { getDebug } from '../../../Types/Debug.js';
import type { ApiRecord } from '../AutoMapperFacade/AutoMapperTypes.js';

const LOG = getDebug(import.meta.url);

/** Preview length for the raw body trace dump. */
const BODY_PREVIEW_CHARS = 4096;

/**
 * Stringify a response body, returning a short failure marker on throw.
 * @param body - API body.
 * @returns Full JSON or '<unstringifiable>'.
 */
function safeStringify(body: ApiRecord): string {
  try {
    return JSON.stringify(body);
  } catch {
    return '<unstringifiable>';
  }
}

/**
 * Truncate a JSON string for trace dumps.
 * @param json - Full JSON string.
 * @returns Truncated preview.
 */
function truncatePreview(json: string): string {
  if (json.length <= BODY_PREVIEW_CHARS) return json;
  return `${json.slice(0, BODY_PREVIEW_CHARS)}…`;
}

/**
 * Trace-dump the raw response shape when extraction fails. Helps
 * diagnose bank-specific API formats (e.g. Hapoalim) without
 * stopping the pipeline.
 * @param responseBody - The raw API body that yielded zero items.
 * @returns Always true (side-effect only).
 */
function traceRawShape(responseBody: ApiRecord): true {
  const topLevelKeys = Object.keys(responseBody);
  const json = safeStringify(responseBody);
  const preview = truncatePreview(json);
  LOG.trace({
    message: 'extractAccountRecords: 0 items — raw body shape',
    topLevelKeys,
    preview,
  });
  return true;
}

export default traceRawShape;
