/**
 * Camoufox-backed identity fetch strategy — routes REST calls through a
 * Camoufox browser session so the underlying TLS ClientHello carries a
 * Firefox JA3/JA4 fingerprint. Used by banks whose Cloudflare edge rejects
 * Node undici's TLS handshake (currently: OneZero identity host).
 *
 * Lifecycle: lazy-launches Camoufox on first call, navigates the page to the
 * constructor's originUrl so subsequent page.evaluate(fetch) calls are
 * same-origin. Caller MUST invoke dispose() at scrape finalize.
 */

import type { Browser, Page } from 'playwright-core';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { LifecyclePromise, Nullable } from '../../../Base/Interfaces/CallbackTypes.js';
import { launchCamoufox } from '../../Mediator/Browser/CamoufoxLauncher.js';
import type { Brand, SafeUrlForLog } from '../../Types/Brand.js';
import { mintSafeUrlForLog } from '../../Types/Brand.js';
import { getDebug } from '../../Types/Debug.js';
import { toErrorMessage } from '../../Types/ErrorUtils.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type { IFetchOpts, IFetchStrategy, PostData } from './FetchStrategy.js';

const LOG = getDebug(import.meta.url);

/** Maximum length of a response-body snippet embedded in an error message. */
const ERROR_BODY_SNIPPET_LEN = 120;

/**
 * Cloudflare IE7-fallback HTML markers. A non-2xx response body containing
 * any of these substrings is classified as WafBlocked — symmetry with
 * WAF_BLOCK_PATTERNS observability without touching the shared list.
 */
const CF_HTML_MARKERS = ['oldie', 'cf-error'] as const;

type LaunchDurationMs = Brand<number, 'LaunchDurationMs'>;
type SetCookieEmitCount = Brand<number, 'SetCookieEmitCount'>;
type HttpVerb = 'GET' | 'POST';

/** Envelope returned by the in-page fetch wrapper. */
interface IPageFetchEnvelope {
  readonly ok: boolean;
  readonly status: number;
  readonly bodyText: string;
  readonly setCookies: readonly string[];
}

/** Args bundle for the in-page fetch invocation. */
interface IInPageFetchArgs {
  readonly url: string;
  readonly method: HttpVerb;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

/** Args bundle for the dispatch helper (verb + url + body + opts). */
interface IDispatchArgs {
  readonly verb: HttpVerb;
  readonly url: string;
  readonly body: string | null;
  readonly opts: IFetchOpts;
}

/**
 * Strips query string and credentials from a URL for safe logging.
 * @param url - Full URL to sanitize.
 * @returns Origin + path only as a branded SafeUrlForLog.
 */
function safeUrlForLog(url: string): SafeUrlForLog {
  try {
    const parsed = new URL(url);
    return mintSafeUrlForLog(`${parsed.origin}${parsed.pathname}`);
  } catch {
    return mintSafeUrlForLog('<unparseable>');
  }
}

/**
 * Merges the default JSON content-type with caller-supplied headers.
 * Caller wins on collision.
 * @param extraHeaders - Caller-supplied headers.
 * @returns Merged headers record.
 */
function mergeHeaders(extraHeaders: Record<string, string>): Record<string, string> {
  return { 'content-type': 'application/json', ...extraHeaders };
}

/**
 * Runs the fetch wrapper inside the Camoufox page context.
 * @param page - Active Camoufox page sharing origin with args.url.
 * @param args - URL + method + headers + body (null for GET).
 * @returns Serialized envelope from the in-page fetch().
 */
async function runFetchInPage(page: Page, args: IInPageFetchArgs): Promise<IPageFetchEnvelope> {
  return page.evaluate(async (input: IInPageFetchArgs): Promise<IPageFetchEnvelope> => {
    const init: RequestInit = { method: input.method, headers: input.headers };
    if (input.body !== null) init.body = input.body;
    const response = await fetch(input.url, init);
    const bodyText = await response.text();
    const setCookies = response.headers.getSetCookie();
    return { ok: response.ok, status: response.status, bodyText, setCookies };
  }, args);
}

/**
 * Determines whether a body snippet matches a known Cloudflare interstitial.
 * @param body - Raw response body text.
 * @returns True when any CF_HTML_MARKERS substring is present.
 */
function isCloudflareHtml(body: string): boolean {
  const lower = body.toLowerCase();
  return CF_HTML_MARKERS.some((m): boolean => lower.includes(m));
}

/**
 * Resolves the error category for a non-2xx body — Cloudflare HTML interstitials
 * surface as WafBlocked, all other shapes stay Generic. Map-driven to satisfy
 * the project's no-ternary rule.
 * @param body - Raw response body text.
 * @returns ScraperErrorTypes category.
 */
function classifyBody(body: string): ScraperErrorTypes {
  if (isCloudflareHtml(body)) return ScraperErrorTypes.WafBlocked;
  return ScraperErrorTypes.Generic;
}

/**
 * Classifies a non-2xx envelope into a Procedure failure.
 * @param env - In-page fetch envelope.
 * @param verb - HTTP verb.
 * @param url - Target URL.
 * @returns Structured failure with status + body snippet.
 */
function classifyNon2xx<T>(env: IPageFetchEnvelope, verb: HttpVerb, url: string): Procedure<T> {
  const snippet = env.bodyText.slice(0, ERROR_BODY_SNIPPET_LEN);
  const message = `${verb} ${url} ${String(env.status)}: ${snippet}`;
  const errorType = classifyBody(env.bodyText);
  return fail(errorType, message);
}

/**
 * Parses a 2xx envelope body as JSON.
 * @param env - In-page fetch envelope.
 * @param verb - HTTP verb.
 * @param url - Target URL.
 * @returns Succeed with parsed body, or Generic parse-error failure.
 */
function parseJsonEnvelope<T>(env: IPageFetchEnvelope, verb: HttpVerb, url: string): Procedure<T> {
  try {
    const parsed = JSON.parse(env.bodyText) as T;
    return succeed(parsed);
  } catch (error) {
    const reason = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `${verb} ${url} parse error: ${reason}`);
  }
}

/**
 * Emits Set-Cookie lines through the caller's hook (empty array still fires
 * once for contract symmetry with NativeFetchStrategy).
 * @param setCookies - Set-Cookie lines extracted in the page context.
 * @param hook - Optional caller-supplied callback.
 * @returns Number of lines forwarded to the hook (0 when no hook).
 */
function emitSetCookies(
  setCookies: readonly string[],
  hook?: IFetchOpts['onSetCookie'],
): SetCookieEmitCount {
  if (!hook) return 0 as SetCookieEmitCount;
  hook(setCookies);
  return setCookies.length as SetCookieEmitCount;
}

/**
 * Closes the captured browser handle, swallowing any close exception so the
 * caller's original failure path is never masked. No-op when called twice or
 * when the strategy was never launched.
 * @param wasDisposed - Whether dispose was already invoked previously.
 * @param browser - Captured browser handle (null when never launched).
 * @returns Resolves once close has been attempted (or immediately when no-op).
 */
async function closeBrowserSafe(
  wasDisposed: boolean,
  browser: Nullable<Browser>,
): LifecyclePromise {
  const action = pickDisposeAction(wasDisposed, browser);
  await action();
}

/**
 * Resolves the dispose action to run given the current lifecycle state.
 * @param wasDisposed - Whether dispose was already invoked previously.
 * @param browser - Captured browser handle (null when never launched).
 * @returns A zero-arg async action that emits the right log + close call.
 */
function pickDisposeAction(
  wasDisposed: boolean,
  browser: Nullable<Browser>,
): () => LifecyclePromise {
  if (wasDisposed) return logDisposeNoop;
  if (!browser) return logDisposeNeverLaunched;
  return (): LifecyclePromise => closeOrSwallow(browser);
}

/**
 * Logs the idempotent no-op branch of dispose.
 * @returns Always-resolved Promise.
 */
function logDisposeNoop(): LifecyclePromise {
  LOG.debug({ message: '[camoufox-identity] dispose (already disposed)' });
  return Promise.resolve();
}

/**
 * Logs the never-launched branch of dispose.
 * @returns Always-resolved Promise.
 */
function logDisposeNeverLaunched(): LifecyclePromise {
  LOG.debug({ message: '[camoufox-identity] dispose (never launched)' });
  return Promise.resolve();
}

/**
 * Awaits browser.close() and logs the outcome; swallows any thrown error.
 * @param browser - Live browser handle to close.
 * @returns Resolves once close completes (success or swallowed failure).
 */
async function closeOrSwallow(browser: Browser): LifecyclePromise {
  try {
    await browser.close();
    LOG.debug({ message: '[camoufox-identity] dispose' });
  } catch (error) {
    LOG.debug({
      errorMessage: toErrorMessage(error as Error),
      message: '[camoufox-identity] dispose IGNORED',
    });
  }
}

/**
 * Fires the in-page fetch and routes the envelope through parse/classify.
 * @param page - Active Camoufox page.
 * @param args - Dispatch args bundle.
 * @returns Procedure with parsed body, parse error, or structured failure.
 */
async function dispatch<T>(page: Page, args: IDispatchArgs): Promise<Procedure<T>> {
  const safeUrl = safeUrlForLog(args.url);
  LOG.debug({ verb: args.verb, url: safeUrl, message: '[camoufox-identity] fetch FIRE' });
  const headers = mergeHeaders(args.opts.extraHeaders);
  const fetchArgs: IInPageFetchArgs = {
    url: args.url,
    method: args.verb,
    headers,
    body: args.body,
  };
  let env: IPageFetchEnvelope;
  try {
    env = await runFetchInPage(page, fetchArgs);
  } catch (error) {
    const reason = toErrorMessage(error as Error);
    return fail(ScraperErrorTypes.Generic, `${args.verb} ${args.url} network error: ${reason}`);
  }
  LOG.debug({
    verb: args.verb,
    url: safeUrl,
    status: env.status,
    message: '[camoufox-identity] fetch STATUS',
  });
  emitSetCookies(env.setCookies, args.opts.onSetCookie);
  if (!env.ok) return classifyNon2xx<T>(env, args.verb, args.url);
  return parseJsonEnvelope<T>(env, args.verb, args.url);
}

/** Camoufox-backed fetch strategy — lazy-launches a Firefox session for TLS. */
class CamoufoxIdentityFetchStrategy implements IFetchStrategy {
  private _browser: Browser | null = null;
  private _page: Page | null = null;
  private _disposed = false;
  private readonly _originUrl: string;

  /**
   * Constructs a strategy bound to a same-origin page.
   * @param originUrl - URL navigated to before fetching (origin used as-is).
   */
  constructor(originUrl: string) {
    this._originUrl = originUrl;
  }

  /**
   * POSTs a JSON body via a Camoufox page session.
   * @param url - Target URL (must share origin with constructor originUrl).
   * @param data - POST body, serialised as JSON.
   * @param opts - Fetch options (extraHeaders + optional onSetCookie hook).
   * @returns Procedure carrying parsed response or structured failure.
   */
  public async fetchPost<T>(url: string, data: PostData, opts: IFetchOpts): Promise<Procedure<T>> {
    return this.runVerb<T>({ verb: 'POST', url, body: JSON.stringify(data), opts });
  }

  /**
   * GETs via a Camoufox page session.
   * @param url - Target URL (must share origin with constructor originUrl).
   * @param opts - Fetch options.
   * @returns Procedure carrying parsed response or structured failure.
   */
  public async fetchGet<T>(url: string, opts: IFetchOpts): Promise<Procedure<T>> {
    return this.runVerb<T>({ verb: 'GET', url, body: null, opts });
  }

  /**
   * Closes the Camoufox browser. Idempotent; safe on a never-launched strategy.
   * @returns Resolves once close completes (or immediately when never launched).
   */
  public async dispose(): LifecyclePromise {
    const wasDisposed = this._disposed;
    this._disposed = true;
    const browser = this._browser;
    this._browser = null;
    this._page = null;
    await closeBrowserSafe(wasDisposed, browser);
  }

  /**
   * Drives one verb end-to-end: ensure launch, fire fetch, classify outcome.
   * @param args - Verb + URL + body + opts bundle.
   * @returns Procedure with parsed body or structured failure.
   */
  private async runVerb<T>(args: IDispatchArgs): Promise<Procedure<T>> {
    if (this._disposed) return fail(ScraperErrorTypes.Generic, 'strategy disposed');
    const pageProc = await this.ensurePage();
    if (!isOk(pageProc)) return pageProc;
    return dispatch<T>(pageProc.value, args);
  }

  /**
   * Ensures Camoufox is launched and a same-origin page is open.
   * Idempotent: subsequent calls reuse the already-launched page.
   * @returns Procedure carrying the active Page, or structured failure.
   */
  private async ensurePage(): Promise<Procedure<Page>> {
    if (this._page) return succeed(this._page);
    const safeOrigin = safeUrlForLog(this._originUrl);
    LOG.debug({ origin: safeOrigin, message: '[camoufox-identity] launch START' });
    const t0 = Date.now();
    let browser: Browser;
    try {
      browser = await launchCamoufox(true);
    } catch (error) {
      const reason = toErrorMessage(error as Error);
      LOG.debug({
        origin: safeOrigin,
        errorMessage: reason,
        message: '[camoufox-identity] launch FAIL',
      });
      return fail(ScraperErrorTypes.Generic, `camoufox launch failed: ${reason}`);
    }
    this._browser = browser;
    const durationMs = (Date.now() - t0) as LaunchDurationMs;
    LOG.debug({ origin: safeOrigin, durationMs, message: '[camoufox-identity] launch END' });
    return this.openPage(browser);
  }

  /**
   * Opens a context + page in the launched browser and navigates to origin.
   * @param browser - Launched Camoufox browser.
   * @returns Procedure carrying the active Page, or Generic nav failure.
   */
  private async openPage(browser: Browser): Promise<Procedure<Page>> {
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(this._originUrl);
      this._page = page;
      return succeed(page);
    } catch (error) {
      const reason = toErrorMessage(error as Error);
      return fail(ScraperErrorTypes.Generic, `camoufox nav failed: ${reason}`);
    }
  }
}

export default CamoufoxIdentityFetchStrategy;
export { CamoufoxIdentityFetchStrategy };
