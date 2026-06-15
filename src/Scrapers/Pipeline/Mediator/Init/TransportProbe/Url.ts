/**
 * Target-URL parsing for the transport probe. Wraps the WHATWG `URL`
 * constructor (which throws on malformed input) in a tagged outcome so
 * the probe's always-resolves; never-throws contract holds for bad
 * URLs.
 */

import { toError } from '../../../Types/ErrorUtils.js';
import { EMPTY_URL, type IUrlParts } from './Types.js';

/**
 * Default port for the resolved scheme — split out so the parser
 * does not use nested ternary expressions (forbidden by lint).
 *
 * @param isTls - True for `https:`.
 * @returns 443 when TLS, 80 otherwise.
 */
function defaultPortForScheme(isTls: boolean): number {
  if (isTls) return 443;
  return 80;
}

/**
 * Parse the target URL into the parts the probe needs. Uses
 * the WHATWG URL constructor so encoded hosts are handled correctly.
 *
 * @param targetUrl - URL string (must include scheme).
 * @returns Hostname, port (explicit or scheme default), and TLS flag.
 */
function parseTargetUrl(targetUrl: string): IUrlParts {
  const parsed = new URL(targetUrl);
  const isTls = parsed.protocol === 'https:';
  const explicitPort = parsed.port;
  const port = explicitPort ? Number(explicitPort) : defaultPortForScheme(isTls);
  return { host: parsed.hostname, port, isTls };
}

/** Tagged result of {@link tryParseTargetUrl}. */
export interface IParseUrlOutcome {
  readonly isOk: boolean;
  readonly url: IUrlParts;
  readonly errorText: string;
}

/**
 * Safely parse the target URL — `new URL(...)` throws on malformed
 * input, so we wrap that call here to honour the always-resolves
 * contract of `probeTransportWithDeps`.
 *
 * @param targetUrl - URL string to parse.
 * @returns Tagged outcome carrying either parsed parts or the error message.
 */
export function tryParseTargetUrl(targetUrl: string): IParseUrlOutcome {
  try {
    return { isOk: true, url: parseTargetUrl(targetUrl), errorText: '' };
  } catch (parseError) {
    const normalized = toError(parseError);
    return { isOk: false, url: EMPTY_URL, errorText: normalized.message };
  }
}
