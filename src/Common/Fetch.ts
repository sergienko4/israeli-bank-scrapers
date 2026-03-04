import { type Page } from 'playwright';

import { getDebug } from './Debug';

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
    return `HTTP ${status}`;
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
    throw new Error(
      `sending a request to the institute server returned with status code ${fetchResult.status}`,
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

export interface FetchGraphqlOptions {
  variables?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
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
    throw new Error(result.errors[0].message);
  }
  return result.data;
}

async function evaluateGet(page: Page, url: string): Promise<readonly [string | null, number]> {
  return page.evaluate(async innerUrl => {
    let response: Response | undefined;
    try {
      response = await fetch(innerUrl, { credentials: 'include' });
      if (response.status === 204) return [null, response.status] as const;
      return [await response.text(), response.status] as const;
    } catch (e) {
      throw new Error(
        `fetchGetWithinPage error: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}, url: ${innerUrl}, status: ${response?.status}`,
        { cause: e },
      );
    }
  }, url);
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
    if (!shouldIgnoreErrors) {
      throw new Error(
        `fetchGetWithinPage parse error: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}, url: ${url}, result: ${result}, status: ${status}`,
        { cause: e },
      );
    }
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
async function doPostFetch(a: {
  u: string;
  d: Record<string, unknown> | unknown[];
  h: Record<string, string>;
}): Promise<readonly [string | null, number]> {
  let response: Response;
  try {
    response = await fetch(a.u, {
      method: 'POST',
      body: JSON.stringify(a.d as unknown),
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', ...a.h },
    });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    throw new Error(`fetchPostWithinPage error: ${msg}, url: ${a.u}`, { cause: e });
  }
  if (response.status === 204) return [null, 204] as const;
  return [await response.text(), response.status] as const;
}

async function runPostEvaluate(
  page: Page,
  args: Parameters<typeof doPostFetch>[0],
): Promise<readonly [string | null, number]> {
  return page.evaluate(doPostFetch, args);
}

function buildParseError(
  e: unknown,
  url: string,
  ctx: {
    data: Record<string, unknown> | unknown[];
    extraHeaders: Record<string, string>;
    status: number;
    text: string | null;
  },
): Error {
  const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
  return new Error(
    `fetchPostWithinPage parse error: ${msg}, url: ${url}, data: ${JSON.stringify(ctx.data)}, extraHeaders: ${JSON.stringify(ctx.extraHeaders)}, result: ${ctx.text}, status: ${ctx.status}`,
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
