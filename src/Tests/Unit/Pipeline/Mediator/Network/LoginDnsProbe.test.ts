/**
 * Unit tests — gated runtime login.dns probe.
 *
 * Covers:
 *   probeLoginDns — emits ONE PII-safe login.dns line resolving every
 *                   Amex/Isracard auth host via an injected resolver.
 *   failure path  — a rejecting host yields empty ips + a PII-safe error
 *                   code, while the other hosts still resolve.
 *   error label   — Error.code wins; an Error without a code falls back to
 *                   its name.
 */

import {
  AUTH_HOSTS,
  probeLoginDns,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/AuthFailureWatcher/LoginDnsProbe.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

/** Payload shape captured by the mock logger's debug calls. */
interface ITraceLog {
  readonly event: string;
  readonly [key: string]: unknown;
}

/** One resolved row inside a login.dns payload. */
interface IDnsRow {
  readonly host: string;
  readonly ips: readonly string[];
  readonly error?: string;
}

/** Resolver fake signature, matching the probe's injectable resolver. */
type ResolverFake = (host: string) => Promise<readonly string[]>;

const [AMEX_WEB, AMEX_HE, ISR_WEB, ISR_HE] = AUTH_HOSTS;

// ---------------------------------------------------------------------------
// Shared factories
// ---------------------------------------------------------------------------

/**
 * Build a logger that stores structured debug payloads.
 * @returns Logger plus captured payloads array.
 */
function makeLogger(): { readonly logger: ScraperLogger; readonly logs: ITraceLog[] } {
  const logs: ITraceLog[] = [];
  /**
   * Capture one debug payload.
   * @param payload - Structured trace payload.
   * @returns True after storing.
   */
  const debug = (payload: ITraceLog): true => {
    logs.push(payload);
    return true;
  };
  return { logger: { debug } as unknown as ScraperLogger, logs };
}

/**
 * Build a resolver fake from a host->outcome table.
 * @param table - Host mapped to its IPs, or an Error to reject with.
 * @returns Resolver that resolves/rejects per the table.
 */
function makeResolver(table: Readonly<Record<string, readonly string[] | Error>>): ResolverFake {
  return host => {
    const entry = table[host];
    if (entry instanceof Error) return Promise.reject(entry);
    return Promise.resolve(entry);
  };
}

/**
 * Read the rows from the single captured login.dns payload.
 * @param logs - Captured debug payloads.
 * @returns The login.dns rows.
 */
function rowsOf(logs: readonly ITraceLog[]): readonly IDnsRow[] {
  return logs[0]?.results as readonly IDnsRow[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('probeLoginDns', () => {
  it('emits one login.dns line resolving every auth host', async () => {
    const { logger, logs } = makeLogger();
    const resolver = makeResolver({
      [AMEX_WEB]: ['192.118.12.98'],
      [AMEX_HE]: ['104.18.0.1'],
      [ISR_WEB]: ['192.118.12.99'],
      [ISR_HE]: ['104.18.0.2'],
    });

    await probeLoginDns(logger, resolver);

    expect(logs).toHaveLength(1);
    expect(logs[0]?.event).toBe('login.dns');
    const rows = rowsOf(logs);
    expect(rows).toEqual([
      { host: AMEX_WEB, ips: ['192.118.12.98'] },
      { host: AMEX_HE, ips: ['104.18.0.1'] },
      { host: ISR_WEB, ips: ['192.118.12.99'] },
      { host: ISR_HE, ips: ['104.18.0.2'] },
    ]);
  });

  it('records empty ips + error code for a failing host while others resolve', async () => {
    const { logger, logs } = makeLogger();
    const notFound = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    const resolver = makeResolver({
      [AMEX_WEB]: notFound,
      [AMEX_HE]: ['104.18.0.1'],
      [ISR_WEB]: ['192.118.12.99'],
      [ISR_HE]: ['104.18.0.2'],
    });

    await probeLoginDns(logger, resolver);

    const rows = rowsOf(logs);
    expect(rows).toEqual([
      { host: AMEX_WEB, ips: [], error: 'ENOTFOUND' },
      { host: AMEX_HE, ips: ['104.18.0.1'] },
      { host: ISR_WEB, ips: ['192.118.12.99'] },
      { host: ISR_HE, ips: ['104.18.0.2'] },
    ]);
  });

  it('falls back to the Error name when no code is present', async () => {
    const { logger, logs } = makeLogger();
    const resolver = makeResolver({
      [AMEX_WEB]: new TypeError('boom'),
      [AMEX_HE]: [],
      [ISR_WEB]: [],
      [ISR_HE]: [],
    });

    await probeLoginDns(logger, resolver);

    const rows = rowsOf(logs);
    expect(rows).toEqual([
      { host: AMEX_WEB, ips: [], error: 'TypeError' },
      { host: AMEX_HE, ips: [] },
      { host: ISR_WEB, ips: [] },
      { host: ISR_HE, ips: [] },
    ]);
  });
});
