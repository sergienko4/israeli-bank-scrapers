/**
 * Gated runtime DNS probe for the Amex/Isracard cross-subdomain auth hosts.
 *
 * Fired ONCE from the PIPELINE_AUTH_REQ_TRACE gated path in the auth-failure
 * watcher (Factory.ts). When the gate is OFF (production default) this never
 * runs, so it adds zero work and zero browser-visible behavior. It resolves
 * the web./he. hosts the login handshake depends on and logs a PII-safe
 * `login.dns` line so a CI trace can separate DNS-resolve from reachability
 * from window-block: the adjacent web.isracard.co.il row is the GREEN control
 * for the web.americanexpress.co.il row (same /24, shared backend).
 */

import { promises as dns } from 'node:dns';

import type { ScraperLogger } from '../../../Types/Debug.js';

/** Hosts the Amex/Isracard `he.->web.` auth handshake depends on. */
export const AUTH_HOSTS = [
  'web.americanexpress.co.il',
  'he.americanexpress.co.il',
  'web.isracard.co.il',
  'he.isracard.co.il',
] as const;

/** Resolve a hostname to its IPv4 addresses. Injectable for tests. */
type Resolver = (host: string) => Promise<readonly string[]>;

/** One host's resolution outcome; `error` is set only on failure. */
interface IDnsResult {
  readonly host: string;
  readonly ips: readonly string[];
  readonly error?: string;
}

/**
 * Resolve a host to IPv4 addresses via Node's dns.resolve4.
 * @param host - Hostname to resolve.
 * @returns The resolved IPv4 addresses.
 */
function defaultResolver(host: string): Promise<readonly string[]> {
  return dns.resolve4(host);
}

/**
 * Extract a PII-safe error label (Node error code or Error name).
 * @param error - Unknown thrown value.
 * @returns The error `code` string when present, else the Error name.
 */
function errCode(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  if ('code' in error && typeof error.code === 'string') return error.code;
  return error.name;
}

/**
 * Resolve one host, never throwing; failures become an `error` field.
 * @param host - Hostname to resolve.
 * @param resolve - Injected resolver.
 * @returns Resolution outcome for the host.
 */
async function resolveOne(host: string, resolve: Resolver): Promise<IDnsResult> {
  try {
    const ips = await resolve(host);
    return { host, ips };
  } catch (error) {
    return { host, ips: [], error: errCode(error) };
  }
}

/**
 * Resolve the Amex/Isracard auth hosts and emit one PII-safe login.dns line.
 * Never throws; intended to be fire-and-forget from the gated trace path.
 * @param logger - Pipeline logger.
 * @param resolve - Injected resolver (defaults to dns.resolve4).
 * @returns Promise resolving after the login.dns line is emitted.
 */
export async function probeLoginDns(logger: ScraperLogger, resolve?: Resolver): Promise<void> {
  const resolveFn = resolve ?? defaultResolver;
  const pending = AUTH_HOSTS.map(host => resolveOne(host, resolveFn));
  const results = await Promise.all(pending);
  logger.debug({ event: 'login.dns', results });
}
