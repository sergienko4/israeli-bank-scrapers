import { type Page } from 'playwright';

import type { FetchGraphqlOptions } from '../Interfaces/Common/FetchGraphqlOptions';
import { ScraperWebsiteChangedError } from '../Scrapers/Base/ScraperWebsiteChangedError';
import { getDebug } from './Debug';

export type { FetchGraphqlOptions } from '../Interfaces/Common/FetchGraphqlOptions';

const LOG = getDebug('fetch');

const JSON_CONTENT_TYPE = 'application/json';
const WAF_BLOCK_PATTERNS = [
  'block automation',
  'attention required',
  'just a moment',
  'access denied',
] as const;

function getJsonHeaders(): Record<string, string> {
  return {
    Accept: JSON_CONTENT_TYPE,
    'Content-Type': JSON_CONTENT_TYPE,
  };
}

export function detectWafBlock(status: number, body: string | null): string | null {
  if (status === 403 || status === 429 || status === 503) {
    return `HTTP ${String(status)}`;
  }
  if (!body) return null;
  const lower = body.toLowerCase();
  const match = WAF_BLOCK_PATTERNS.find(pattern => lower.includes(pattern));
  return match ? `response contains "${match}"` : null;
}

function logApiCall(tag: string, status: number, durationMs: number): void {
  LOG.info('%s → %d (%dms)', tag, status, durationMs);
}

function logResponseIssues(status: number, text: string | null, url: string): void {
  if (text !== null) LOG.info('response body: %s', text.substring(0, 300));
  if (status !== 200 && status !== 204) {
    LOG.info('non-200: status=%d url=%s', status, url);
  }
  const wafReason = detectWafBlock(status, text);
  if (wafReason) {
    LOG.info('WAF block: %s url=%s', wafReason, url);
  }
}

export async function fetchGet<TResult>(
  url: string,
  extraHeaders: Record<string, string>,
): Promise<TResult> {
  const headers = Object.assign(getJsonHeaders(), extraHeaders);
  const startMs = Date.now();
  const fetchResult = await fetch(url, { method: 'GET', headers });
  logApiCall(`GET ${url.slice(-100)}`, fetchResult.status, Date.now() - startMs);
  const text = await fetchResult.text();
  LOG.info('response body: %s', text.substring(0, 300));
  if (fetchResult.status !== 200) {
    throw new ScraperWebsiteChangedError(
      'Fetch',
      `request to institute server failed with status ${String(fetchResult.status)}`,
    );
  }
  return JSON.parse(text) as TResult;
}

export async function fetchPost<TResult = unknown>(
  url: string,
  data: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<TResult> {
  const request = {
    method: 'POST',
    headers: { ...getJsonHeaders(), ...extraHeaders },
    body: JSON.stringify(data),
  };
  const startMs = Date.now();
  const result = await fetch(url, request);
  logApiCall(`POST ${url.slice(-100)}`, result.status, Date.now() - startMs);
  const text = await result.text();
  LOG.info('response body: %s', text.substring(0, 300));
  return JSON.parse(text) as TResult;
}

export async function fetchGraphql<TResult>(
  url: string,
  query: string,
  opts: FetchGraphqlOptions = {},
): Promise<TResult> {
  const { variables = {}, extraHeaders = {} } = opts;
  const result = await fetchPost<{ data: TResult; errors?: { message: string }[] }>(
    url,
    { operationName: null, query, variables },
    extraHeaders,
  );
  if (result.errors?.length) {
    throw new ScraperWebsiteChangedError('Fetch', result.errors[0].message);
  }
  return result.data;
}

function assertEvalGetOk(result: { ok: boolean; err?: string; status: number }, url: string): void {
  if (!result.ok)
    throw new ScraperWebsiteChangedError(
      'Fetch',
      `fetchGetWithinPage error: ${result.err ?? ''}, url: ${url}, status: ${String(result.status)}`,
    );
}

async function evaluateGet(page: Page, url: string): Promise<readonly [string | null, number]> {
  // Use `as const` on ok: so TypeScript infers the discriminated union — no top-level type needed.
  const evalResult = await page.evaluate(async (innerUrl: string) => {
    let response: Response | undefined;
    try {
      response = await fetch(innerUrl, { credentials: 'include' });
      const s = response.status;
      if (s === 204) return { ok: true as const, text: null as string | null, status: s };
      return { ok: true as const, text: (await response.text()) as string | null, status: s };
    } catch (e) {
      const errMsg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      return { ok: false as const, err: errMsg, status: response?.status ?? 0 };
    }
  }, url);
  assertEvalGetOk(evalResult, url);
  return [evalResult.text ?? null, evalResult.status] as const;
}

function throwGetParseError(
  e: unknown,
  ctx: { url: string; result: string; status: number },
): never {
  const errMsg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  throw new ScraperWebsiteChangedError(
    'Fetch',
    `fetchGetWithinPage parse error: ${errMsg}, ` +
      `url: ${ctx.url}, result: ${ctx.result}, status: ${String(ctx.status)}`,
  );
}

function parseGetResult(opts: {
  result: string | null;
  status: number;
  url: string;
  shouldIgnoreErrors: boolean;
}): unknown {
  const { result, status, url, shouldIgnoreErrors } = opts;
  if (result === null) return null;
  try {
    return JSON.parse(result) as unknown;
  } catch (e) {
    if (!shouldIgnoreErrors) throwGetParseError(e, { url, result, status });
  }
  return null;
}

export async function fetchGetWithinPage<TResult>(
  page: Page,
  url: string,
  shouldIgnoreErrors = false,
): Promise<TResult | null> {
  const startMs = Date.now();
  const [result, status] = await evaluateGet(page, url);
  logApiCall(`GET(page) ${url.slice(-100)}`, status, Date.now() - startMs);
  logResponseIssues(status, result, url);
  return parseGetResult({ result, status, url, shouldIgnoreErrors }) as TResult | null;
}

// NOTE: doPostFetch runs inside page.evaluate() (browser context).
// Must be entirely self-contained — no external function references allowed.
// Returns a plain object so the result can be JSON-serialised across the evaluate boundary.
async function doPostFetch(a: {
  u: string;
  d: Record<string, unknown> | unknown[];
  h: Record<string, string>;
}): Promise<{ ok: boolean; text: string | null; status: number; err?: string }> {
  let response: Response;
  try {
    response = await fetch(a.u, {
      method: 'POST',
      body: JSON.stringify(a.d as unknown),
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...a.h },
    });
  } catch (e) {
    return { ok: false, text: null, status: 0, err: `fetchPost error: ${String(e)}, url: ${a.u}` };
  }
  if (response.status === 204) return { ok: true, text: null, status: 204 };
  return { ok: true, text: await response.text(), status: response.status };
}

async function runPostEvaluate(
  page: Page,
  args: Parameters<typeof doPostFetch>[0],
): Promise<readonly [string | null, number]> {
  const evalResult = await page.evaluate(doPostFetch, args);
  if (!evalResult.ok) {
    const errMsg = `fetchPostWithinPage error: ${evalResult.err ?? ''}`;
    throw new ScraperWebsiteChangedError('Fetch', errMsg);
  }
  return [evalResult.text, evalResult.status] as const;
}

function buildParseError(
  e: unknown,
  url: string,
  errCtx: {
    data: Record<string, unknown> | unknown[];
    extraHeaders: Record<string, string>;
    status: number;
    text: string | null;
  },
): Error {
  const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
  const dataStr = JSON.stringify(errCtx.data);
  const headersStr = JSON.stringify(errCtx.extraHeaders);
  return new Error(
    `fetchPostWithinPage parse error: ${msg}, url: ${url}, data: ${dataStr}, ` +
      `extraHeaders: ${headersStr}, result: ${errCtx.text ?? ''}, status: ${String(errCtx.status)}`,
    { cause: e },
  );
}

function parsePostResult(
  text: string | null,
  url: string,
  ctx: {
    data: Record<string, unknown> | unknown[];
    extraHeaders: Record<string, string>;
    shouldIgnoreErrors: boolean;
    status: number;
  },
): unknown {
  try {
    if (text !== null) return JSON.parse(text) as unknown;
  } catch (e) {
    if (!ctx.shouldIgnoreErrors) throw buildParseError(e, url, { ...ctx, text });
  }
  return null;
}

export async function fetchPostWithinPage<TResult>(
  page: Page,
  url: string,
  opts: {
    data: Record<string, unknown> | unknown[];
    extraHeaders?: Record<string, string>;
    shouldIgnoreErrors?: boolean;
  },
): Promise<TResult | null> {
  const { data, extraHeaders = {}, shouldIgnoreErrors = false } = opts;
  const startMs = Date.now();
  const [text, status] = await runPostEvaluate(page, { u: url, d: data, h: extraHeaders });
  logApiCall(`POST(page) ${url.slice(-100)}`, status, Date.now() - startMs);
  logResponseIssues(status, text, url);
  const ctx = { data, extraHeaders, shouldIgnoreErrors, status };
  return parsePostResult(text, url, ctx) as TResult | null;
}
