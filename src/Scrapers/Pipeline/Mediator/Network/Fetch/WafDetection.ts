/**
 * Fetch sub-module — WAF / IP-block detection.
 *
 * Inspects the response status + body preview against a fixed pattern
 * table from FetchConfig.ts. Used by Logging.ts to label diagnostics.
 */

import type { Brand } from '../../../Types/Brand.js';
import { WAF_BLOCK_PATTERNS, WAF_STATUS_CODES } from '../FetchConfig.js';

/** WAF/IP block description (empty when no block detected). */
export type WafBlockDescription = Brand<string, 'WafBlockDescription'>;

/**
 * Match the status code against the known WAF table.
 * @param status - HTTP status code.
 * @returns Block description or empty string.
 */
function describeStatusBlock(status: number): WafBlockDescription {
  if (!WAF_STATUS_CODES.has(status)) return '' as WafBlockDescription;
  return `HTTP ${String(status)}` as WafBlockDescription;
}

/**
 * Scan the response body for a WAF pattern match.
 * @param body - Response body text (possibly empty).
 * @returns Block description or empty string.
 */
function describeBodyBlock(body: string): WafBlockDescription {
  if (!body) return '' as WafBlockDescription;
  const lower = body.toLowerCase();
  const match = WAF_BLOCK_PATTERNS.find((pattern): boolean => lower.includes(pattern));
  if (!match) return '' as WafBlockDescription;
  return `response contains "${match}"` as WafBlockDescription;
}

/**
 * Detect WAF/IP block from HTTP status or response body patterns.
 * @param status - The HTTP response status code.
 * @param body - The response body text.
 * @returns A description of the detected block, or empty string if none.
 */
export function detectWafBlock(status: number, body: string): WafBlockDescription {
  const statusHit = describeStatusBlock(status);
  if (statusHit) return statusHit;
  return describeBodyBlock(body);
}
