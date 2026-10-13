/**
 * Browser-stack contract: the installed playwright-core client and the
 * Camoufox build it drives must honour Playwright's documented behaviour for
 * request routing and multi-value response headers.
 *
 * The expectations come from Playwright's API contract, not from what one
 * stack happens to do: `page.route` / `context.route` fulfil a request, and
 * `headersArray()` / `headerValues()` list a header that has several entries,
 * such as `Set-Cookie`, once per entry. They never change per stack. A
 * client/browser pair that breaks one is not landable, however the schema
 * check reads.
 *
 * Every invariant runs against a loopback server on `127.0.0.1:0` in its own
 * browser context, so the file needs no external network and one failure
 * cannot leak cookies or routes into the next. CI runs this file as the first
 * step of the E2E mocked job, so a broken pair fails there with the invariant
 * named, before the full suite starts.
 */

import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { Browser, BrowserContext, Page, Response } from 'playwright-core';

import { closeSharedBrowser, getSharedBrowser } from './Helpers/BrowserFixture.js';

/** Loopback host the contract server binds to. */
const LOOPBACK = '127.0.0.1';

/** Lower-cased name of the multi-value header under test. */
const SET_COOKIE = 'set-cookie';

/** Two cookies the server sets on every response, as two headers (C4). */
const SERVER_COOKIES = ['a=1; Path=/', 'b=2; Path=/'] as const;

/** Two cookies a route fulfils as one newline-separated header value (C3). */
const FULFILLED_COOKIES = 'c=3; Path=/\nd=4; Path=/';

/** Ceiling for launching the browser once for the file. */
const LAUNCH_TIMEOUT_MS = 60_000;

/** Context and page an invariant runs in. */
interface IContractTab {
  readonly context: BrowserContext;
  readonly page: Page;
}

/** Body and cookie jar a fulfilled navigation produced. */
interface INavigation {
  readonly response: Response;
  readonly cookieNames: readonly string[];
}

let browser: Browser;
let server: Server;
let origin: string;

/**
 * Answer every request with the two server cookies (C4).
 *
 * @param _request - Incoming request; its path does not matter.
 * @param response - Response to write.
 * @returns True once the response ends.
 */
function serveTwoCookies(_request: IncomingMessage, response: ServerResponse): boolean {
  response.setHeader('Set-Cookie', [...SERVER_COOKIES]);
  response.end('srv');
  return true;
}

/**
 * Start the contract server on an ephemeral loopback port.
 *
 * @returns The listening server.
 */
async function startServer(): Promise<Server> {
  const started = createServer(serveTwoCookies);
  const isListening = once(started, 'listening');
  started.listen(0, LOOPBACK);
  await isListening;
  return started;
}

/**
 * Origin URL of a listening loopback server.
 *
 * @param listening - Server that already bound its port.
 * @returns `http://127.0.0.1:<port>`.
 */
function originOf(listening: Server): string {
  const address = listening.address();
  const port = address !== null && typeof address === 'object' ? address.port : 0;
  return `http://${LOOPBACK}:${String(port)}`;
}

/**
 * Close the server, dropping keep-alive sockets the browser still holds.
 *
 * @param listening - Server to close.
 * @returns True once the server has closed.
 */
async function stopServer(listening: Server): Promise<boolean> {
  const isClosed = once(listening, 'close');
  listening.close();
  listening.closeAllConnections();
  await isClosed;
  return true;
}

/**
 * Open a fresh context and page so no route or cookie outlives an invariant.
 *
 * @returns The new context and its page.
 */
async function openTab(): Promise<IContractTab> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

/**
 * Navigate to a path on the contract server and read the cookie jar.
 *
 * @param tab - Context and page to navigate in.
 * @param path - Path on the contract server.
 * @returns The navigation response and the jar's cookie names.
 */
async function navigate(tab: IContractTab, path: string): Promise<INavigation> {
  const response = await tab.page.goto(`${origin}${path}`);
  if (response === null) throw new TypeError(`no response for ${path}`);
  const cookies = await tab.context.cookies();
  const cookieNames = cookies.map((cookie): string => cookie.name);
  return { response, cookieNames };
}

/**
 * Values of every `Set-Cookie` entry in the raw header list.
 *
 * @param response - Navigation response.
 * @returns One value per `Set-Cookie` entry, in order.
 */
async function setCookieEntries(response: Response): Promise<readonly string[]> {
  const headers = await response.headersArray();
  const entries = headers.filter((header): boolean => header.name.toLowerCase() === SET_COOKIE);
  return entries.map((header): string => header.value);
}

/**
 * Expected cookie names the jar is missing.
 *
 * @param cookieNames - Names in the context's cookie jar.
 * @param expected - Names the invariant requires.
 * @returns Required names absent from the jar; empty when all are set.
 */
function missingCookies(
  cookieNames: readonly string[],
  expected: readonly string[],
): readonly string[] {
  return expected.filter((name): boolean => !cookieNames.includes(name));
}

beforeAll(async () => {
  browser = await getSharedBrowser();
  server = await startServer();
  origin = originOf(server);
}, LAUNCH_TIMEOUT_MS);

afterAll(async () => {
  await closeSharedBrowser();
  await stopServer(server);
});

describe('Browser stack contract (playwright-core × Camoufox)', () => {
  let tab: IContractTab;

  beforeEach(async () => {
    tab = await openTab();
  });

  afterEach(async () => {
    await tab.context.close();
  });

  it('C1: page.route fulfils a request', async () => {
    await tab.page.route('**/c1', route => route.fulfill({ status: 200, body: 'ok-page' }));
    const { response } = await navigate(tab, '/c1');
    const body = await response.text();
    expect(body).toBe('ok-page');
  });

  it('C2: context.route fulfils a request', async () => {
    await tab.context.route('**/c2', route => route.fulfill({ status: 200, body: 'ok-ctx' }));
    const { response } = await navigate(tab, '/c2');
    const body = await response.text();
    expect(body).toBe('ok-ctx');
  });

  it('C3: a fulfilled two-cookie header sets both cookies and reads back as 2 values', async () => {
    const headers = { [SET_COOKIE]: FULFILLED_COOKIES };
    await tab.context.route('**/c3', route => route.fulfill({ status: 200, body: 'x', headers }));
    const { response, cookieNames } = await navigate(tab, '/c3');
    const values = await response.headerValues(SET_COOKIE);
    const missing = missingCookies(cookieNames, ['c', 'd']);
    const distinctValues = new Set(values);
    expect(missing).toEqual([]);
    expect(distinctValues.size).toBe(2);
  });

  it('C4: two server Set-Cookie headers stay 2 entries and set both cookies', async () => {
    const { response, cookieNames } = await navigate(tab, '/c4');
    const entries = await setCookieEntries(response);
    const values = await response.headerValues(SET_COOKIE);
    const allHeaders = await response.allHeaders();
    const merged = allHeaders[SET_COOKIE];
    const missing = missingCookies(cookieNames, ['a', 'b']);
    expect(entries).toEqual([...SERVER_COOKIES]);
    expect(values).toHaveLength(2);
    expect(merged).toContain('a=1');
    expect(merged).toContain('b=2');
    expect(missing).toEqual([]);
  });
});
