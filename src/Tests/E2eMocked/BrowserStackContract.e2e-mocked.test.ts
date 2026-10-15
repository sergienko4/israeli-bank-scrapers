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

import {
  closeSharedBrowser,
  firstLaunchHookTimeoutMs,
  getSharedBrowser,
} from './Helpers/BrowserFixture.js';

/** Loopback host the contract server binds to. */
const LOOPBACK = '127.0.0.1';

/** Lower-cased name of the multi-value header under test. */
const SET_COOKIE = 'set-cookie';

/** Two cookies the server sets on every response, as two headers (C4). */
const SERVER_COOKIES = ['a=1; Path=/', 'b=2; Path=/'] as const;

/** Two cookies a route fulfils as one newline-separated header value (C3). */
const FULFILLED_COOKIES = 'c=3; Path=/\nd=4; Path=/';

/** The entries C3's fulfilled header must read back as, one per line. */
const FULFILLED_ENTRIES = FULFILLED_COOKIES.split('\n');

/** Bound for the setup hook, which takes the job's first Camoufox launch. */
const SETUP_TIMEOUT_MS = firstLaunchHookTimeoutMs();

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
let server: Server | undefined;
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
 * Open a page in a fresh context so no route or cookie outlives an invariant.
 *
 * @param context - The test's fresh context.
 * @returns The context and its new page.
 */
async function openTab(context: BrowserContext): Promise<IContractTab> {
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
 * Expected items the actual list is missing, in any order. Paired with a
 * length check it proves the list holds exactly the expected items.
 *
 * @param actual - Cookie names or header values the stack produced.
 * @param expected - Items the invariant requires.
 * @returns Required items absent from `actual`; empty when all are there.
 */
function missingFrom(actual: readonly string[], expected: readonly string[]): readonly string[] {
  return expected.filter((item): boolean => !actual.includes(item));
}

beforeAll(async () => {
  browser = await getSharedBrowser();
  server = await startServer();
  origin = originOf(server);
}, SETUP_TIMEOUT_MS);

afterAll(async () => {
  await closeSharedBrowser();
  if (server) await stopServer(server);
});

describe('Browser stack contract (playwright-core × Camoufox)', () => {
  let tab: IContractTab;
  /** This test's context, kept on open so cleanup closes it even if `newPage` fails. */
  let opened: BrowserContext | undefined;

  beforeEach(async () => {
    opened = await browser.newContext();
    tab = await openTab(opened);
  });

  afterEach(async () => {
    await opened?.close();
    opened = undefined;
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

  it('C3: a fulfilled two-cookie header sets both cookies and reads back as 2 entries', async () => {
    const headers = { [SET_COOKIE]: FULFILLED_COOKIES };
    await tab.context.route('**/c3', route => route.fulfill({ status: 200, body: 'x', headers }));
    const { response, cookieNames } = await navigate(tab, '/c3');
    const entries = await setCookieEntries(response);
    const values = await response.headerValues(SET_COOKIE);
    const missing = missingFrom(cookieNames, ['c', 'd']);
    const missingEntries = missingFrom(entries, FULFILLED_ENTRIES);
    const missingValues = missingFrom(values, FULFILLED_ENTRIES);
    expect(missing).toEqual([]);
    expect(entries).toHaveLength(2);
    expect(missingEntries).toEqual([]);
    expect(values).toHaveLength(2);
    expect(missingValues).toEqual([]);
  });

  it('C4: two server Set-Cookie headers stay 2 entries and set both cookies', async () => {
    const { response, cookieNames } = await navigate(tab, '/c4');
    const entries = await setCookieEntries(response);
    const values = await response.headerValues(SET_COOKIE);
    const allHeaders = await response.allHeaders();
    const merged = allHeaders[SET_COOKIE];
    const missing = missingFrom(cookieNames, ['a', 'b']);
    const missingEntries = missingFrom(entries, SERVER_COOKIES);
    const missingValues = missingFrom(values, SERVER_COOKIES);
    expect(entries).toHaveLength(2);
    expect(missingEntries).toEqual([]);
    expect(values).toHaveLength(2);
    expect(missingValues).toEqual([]);
    expect(merged).toContain('a=1');
    expect(merged).toContain('b=2');
    expect(missing).toEqual([]);
  });
});
