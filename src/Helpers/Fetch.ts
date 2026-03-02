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

function logResponseIssues(status: number, text: string | null, url: string): void {
  if (status !== 200 && status !== 204) {
    LOG.debug(
      'non-200 response: status=%d url=%s body=%s',
      status,
      url,
      text?.substring(0, 200) ?? 'empty',
    );
  }
  const wafReason = detectWafBlock(status, text);
  if (wafReason) {
    LOG.debug('WAF block detected: %s, url=%s', wafReason, url);
  }
}

export async function fetchGet<TResult>(
  url: string,
  extraHeaders: Record<string, string>,
): Promise<TResult> {
  const headers = Object.assign(getJsonHeaders(), extraHeaders);
  const fetchResult = await fetch(url, { method: 'GET', headers });

  if (fetchResult.status !== 200) {
    throw new Error(
      `sending a request to the institute server returned with status code ${fetchResult.status}`,
    );
  }

  return (await fetchResult.json()) as TResult;
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
  const result = await fetch(url, request);
  return (await result.json()) as TResult;
}

export interface FetchGraphqlOptions {
  variables?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
}

interface GraphqlResponse<TResult> {
  data: TResult;
  errors?: { message: string }[];
}

export async function fetchGraphql<TResult>(
  url: string,
  query: string,
  opts: FetchGraphqlOptions = {},
): Promise<TResult> {
  const { variables = {}, extraHeaders = {} } = opts;
  const result = await fetchPost<GraphqlResponse<TResult>>(
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
      );
    }
  }, url);
}

export interface ParseGetOpts {
  result: string | null;
  status: number;
  url: string;
  shouldIgnoreErrors: boolean;
}

function parseGetResult(opts: ParseGetOpts): unknown {
  const { result, status, url, shouldIgnoreErrors } = opts;
  if (result === null) return null;
  try {
    return JSON.parse(result) as unknown;
  } catch (e) {
    if (!shouldIgnoreErrors) {
      throw new Error(
        `fetchGetWithinPage parse error: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}, url: ${url}, result: ${result}, status: ${status}`,
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
  const [result, status] = await evaluateGet(page, url);
  return parseGetResult({ result, status, url, shouldIgnoreErrors }) as TResult | null;
}

export interface FetchPostOptions {
  data: Record<string, unknown> | unknown[];
  extraHeaders?: Record<string, string>;
  shouldIgnoreErrors?: boolean;
}

interface PostEvalArgs {
  innerUrl: string;
  innerData: Record<string, unknown> | unknown[];
  innerExtraHeaders: Record<string, string>;
}

// NOTE: doPostFetch runs inside page.evaluate() (browser context).
// Must be entirely self-contained — no external function references allowed.
async function doPostFetch(args: PostEvalArgs): Promise<readonly [string | null, number]> {
  const { innerUrl, innerData, innerExtraHeaders } = args;
  let response: Response;

  try {
    response = await fetch(innerUrl, {
      method: 'POST',
      body: JSON.stringify(innerData as unknown),
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        ...innerExtraHeaders,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
    throw new Error(`fetchPostWithinPage error: ${msg}, url: ${innerUrl}`);
  }

  if (response.status === 204) return [null, 204] as const;
  return [await response.text(), response.status] as const;
}

async function runPostEvaluate(
  page: Page,
  args: PostEvalArgs,
): Promise<readonly [string | null, number]> {
  return page.evaluate(doPostFetch, args);
}

export interface ParsePostOpts {
  text: string | null;
  status: number;
  url: string;
  opts: FetchPostOptions;
}

function parsePostResult(pOpts: ParsePostOpts): unknown {
  const { text, status, url, opts } = pOpts;
  const { data, extraHeaders = {}, shouldIgnoreErrors = false } = opts;
  try {
    if (text !== null) return JSON.parse(text) as unknown;
  } catch (e) {
    if (!shouldIgnoreErrors) {
      throw new Error(
        `fetchPostWithinPage parse error: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}, url: ${url}, data: ${JSON.stringify(data)}, extraHeaders: ${JSON.stringify(extraHeaders)}, result: ${text}, status: ${status}`,
      );
    }
  }
  return null;
}

export async function fetchPostWithinPage<TResult>(
  page: Page,
  url: string,
  opts: FetchPostOptions,
): Promise<TResult | null> {
  const { data, extraHeaders = {} } = opts;
  const [text, status] = await runPostEvaluate(page, {
    innerUrl: url,
    innerData: data,
    innerExtraHeaders: extraHeaders,
  });
  logResponseIssues(status, text, url);
  return parsePostResult({ text, status, url, opts }) as TResult | null;
}
