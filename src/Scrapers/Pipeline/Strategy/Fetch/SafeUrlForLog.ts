/**
 * The one URL sanitizer every fetch transport uses for log lines and error
 * messages. Query strings carry session ids, tokens, device ids and PII, so
 * only the origin and path ever leave a transport.
 */

import type { SafeUrlForLog } from '../../Types/Brand.js';
import { mintSafeUrlForLog } from '../../Types/Brand.js';

/** Stand-in for a URL that cannot be parsed, so nothing raw is echoed. */
const UNPARSEABLE_URL = '<unparseable>';

/**
 * Strip query string, fragment and credentials from a URL.
 * @param url - Full URL to sanitize.
 * @returns Origin + path only as a branded SafeUrlForLog.
 */
function safeUrlForLog(url: string): SafeUrlForLog {
  try {
    const parsed = new URL(url);
    return mintSafeUrlForLog(`${parsed.origin}${parsed.pathname}`);
  } catch {
    return mintSafeUrlForLog(UNPARSEABLE_URL);
  }
}

export default safeUrlForLog;
export { safeUrlForLog };
