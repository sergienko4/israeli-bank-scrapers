/**
 * Unit tests for MirrorSimulator. We exercise the state-machine logic
 * by capturing the route handler the simulator installs on a stubbed
 * Page, then invoking that handler with synthetic Route + Request.
 *
 * Manifest + fixture bodies live in a temp directory so the loader
 * can be exercised end-to-end without committing test fixtures.
 *
 * Coverage:
 *   - happy-path phase advance fires fulfill with expected body + status
 *   - OTP_TRIGGER injects Set-Cookie with challenge nonce
 *   - OTP_FILL accepts when nonce + code match
 *   - OTP_FILL rejects (throws) when nonce missing
 *   - escape classification — fatal entry recorded; benign aborted silently
 *   - ambiguous manifest match throws
 *   - backward transition rejected by forward-only guard
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Page, Request, Route } from 'playwright-core';

import ScraperError from '../../../../Scrapers/Base/ScraperError.js';
import { installSimulator } from '../../../Integration/Mirror/MirrorSimulator.js';

const BANK_ID = 'simbank';
const HOME_BODY = '<html>home</html>';
const OTP_TRIGGER_BODY = '<html>otp-trigger</html>';
const OTP_FILL_BODY = '{"ok":true}';

const FIXTURES_OK = {
  'init.html': '<html>init</html>',
  'home.html': HOME_BODY,
  'otp-trigger.html': OTP_TRIGGER_BODY,
  'otp-fill.json': OTP_FILL_BODY,
} as const;

const MANIFEST_SIMPLE = {
  bankId: BANK_ID,
  originUrl: 'https://bank.example.com',
  startPhase: 'INIT',
  endPhase: 'TERMINATE',
  transitions: [
    {
      phase: 'INIT',
      method: 'GET',
      urlPattern: '/init',
      response: { status: 200, contentType: 'text/html', bodyFile: 'init.html' },
      advanceTo: 'HOME',
    },
    {
      phase: 'HOME',
      method: 'GET',
      urlPattern: '/home',
      response: { status: 200, contentType: 'text/html', bodyFile: 'home.html' },
      advanceTo: 'PRE_LOGIN',
    },
  ],
} as const;

const MANIFEST_OTP = {
  bankId: BANK_ID,
  originUrl: 'https://bank.example.com',
  startPhase: 'OTP_TRIGGER',
  endPhase: 'TERMINATE',
  transitions: [
    {
      phase: 'OTP_TRIGGER',
      method: 'POST',
      urlPattern: '/otp/send',
      response: { status: 200, contentType: 'text/html', bodyFile: 'otp-trigger.html' },
      advanceTo: 'OTP_FILL',
    },
    {
      phase: 'OTP_FILL',
      method: 'POST',
      urlPattern: '/otp/verify',
      postData: { shape: 'json', expectations: { code: '123456' } },
      response: { status: 200, contentType: 'application/json', bodyFile: 'otp-fill.json' },
      advanceTo: 'AUTH_DISCOVERY',
    },
  ],
} as const;

const MANIFEST_AMBIGUOUS = {
  bankId: BANK_ID,
  originUrl: 'https://bank.example.com',
  startPhase: 'INIT',
  endPhase: 'TERMINATE',
  transitions: [
    {
      phase: 'INIT',
      method: 'GET',
      urlPattern: '/init',
      response: { status: 200, contentType: 'text/html', bodyFile: 'init.html' },
    },
    {
      phase: 'INIT',
      method: 'GET',
      urlPattern: '/init',
      response: { status: 200, contentType: 'text/html', bodyFile: 'init.html' },
    },
  ],
} as const;

const MANIFEST_BACKWARD = {
  bankId: BANK_ID,
  originUrl: 'https://bank.example.com',
  startPhase: 'HOME',
  endPhase: 'TERMINATE',
  transitions: [
    {
      phase: 'HOME',
      method: 'GET',
      urlPattern: '/back',
      response: { status: 200, contentType: 'text/html', bodyFile: 'home.html' },
      advanceTo: 'INIT',
    },
  ],
} as const;

/** Wrapper handle for the temp fixtures dir + cleanup callback. */
interface IFixturesHandle {
  readonly fixturesRoot: string;
  readonly cleanup: () => boolean;
}

/** Capture object for the handler the simulator installs on the page. */
interface IRouteCapture {
  readonly page: Page;
  readonly invoke: (route: Route, req: Request) => Promise<unknown>;
}

/** Recorded fulfil() call. */
interface IFulfillCapture {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

/** Stubbed Route + recorded interactions. */
interface IRouteStub {
  readonly route: Route;
  readonly fulfilled: IFulfillCapture[];
  readonly abortCount: { value: number };
}

/** Spec for {@link makeRequest}. */
interface IRequestSpec {
  readonly url: string;
  readonly method: string;
  readonly resourceType: string;
  readonly postBody?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Request methods implemented by the stub. */
interface IRequestStubFields {
  readonly url: () => string;
  readonly method: () => string;
  readonly resourceType: () => string;
  readonly postData: () => string;
  readonly headers: () => Record<string, string>;
}

/**
 * Write the manifest JSON file into a bank fixture directory.
 *
 * @param bankDir - Absolute path to the bank's fixture directory.
 * @param manifest - The manifest JSON object.
 * @returns Always true.
 */
function writeManifestJson(bankDir: string, manifest: object): boolean {
  const manifestPath = join(bankDir, 'manifest.json');
  const manifestJson = JSON.stringify(manifest);
  writeFileSync(manifestPath, manifestJson, 'utf8');
  return true;
}

/**
 * Write all body fixture files into a bank fixture directory.
 *
 * @param bankDir - Absolute path to the bank's fixture directory.
 * @param files - Map of relative file name to body contents.
 * @returns Always true.
 */
function writeBodyFiles(bankDir: string, files: Readonly<Record<string, string>>): boolean {
  for (const name of Object.keys(files)) {
    const filePath = join(bankDir, name);
    writeFileSync(filePath, files[name], 'utf8');
  }
  return true;
}

/**
 * Write the manifest + body files into the bank's fixture directory.
 *
 * @param bankDir - Absolute path to the bank's fixture directory.
 * @param manifest - The manifest JSON object.
 * @param files - Map of relative file name to body contents.
 * @returns Always true.
 */
function writeFixtureBodies(
  bankDir: string,
  manifest: object,
  files: Readonly<Record<string, string>>,
): boolean {
  writeManifestJson(bankDir, manifest);
  writeBodyFiles(bankDir, files);
  return true;
}

/**
 * Build a temp-directory cleanup callback.
 *
 * @param root - Temp directory to remove on cleanup.
 * @returns Callback that deletes the directory and returns true.
 */
function makeSimTempCleanup(root: string): () => boolean {
  return (): boolean => {
    rmSync(root, { recursive: true, force: true });
    return true;
  };
}

/**
 * Create a temp fixtures root pre-populated with the manifest + body files.
 *
 * @param manifest - The manifest JSON object.
 * @param files - Map of relative file name to body contents.
 * @returns Handle exposing root + cleanup.
 */
function setupFixtures(manifest: object, files: Readonly<Record<string, string>>): IFixturesHandle {
  const sysTemp = tmpdir();
  const tempPrefix = join(sysTemp, 'mirror-sim-test-');
  const root = mkdtempSync(tempPrefix);
  const bankDir = join(root, BANK_ID);
  mkdirSync(bankDir, { recursive: true });
  writeFixtureBodies(bankDir, manifest, files);
  return { fixturesRoot: root, cleanup: makeSimTempCleanup(root) };
}

/** Handler captured from the stubbed page.route call. */
type RouteHandler = (route: Route, req: Request) => Promise<unknown>;

/** Page route methods implemented by the stub. */
interface IPageRouteMethods {
  readonly route: (_p: string, h: RouteHandler) => Promise<true>;
  readonly unroute: () => Promise<true>;
}

/** Mutable holder for the captured route handler. */
interface IHandlerSlot {
  fn: RouteHandler | undefined;
}

/** Fulfil options shape used by the route stub. */
interface IFulfillOpts {
  readonly status?: number;
  readonly headers?: Record<string, string>;
  readonly body?: Buffer;
}

/**
 * Build the fulfill callback for a Route stub.
 *
 * @param fulfilled - Array to record each fulfill call.
 * @returns Arrow function that records the call and resolves.
 */
function makeRouteFulfillFn(fulfilled: IFulfillCapture[]): (opts: IFulfillOpts) => Promise<true> {
  return (opts: IFulfillOpts): Promise<true> => {
    fulfilled.push({
      status: opts.status ?? 0,
      headers: opts.headers ?? {},
      body: opts.body ?? Buffer.alloc(0),
    });
    return Promise.resolve(true);
  };
}

/**
 * Build the abort callback for a Route stub.
 *
 * @param abortCount - Counter to increment on each abort call.
 * @param abortCount.value - The mutable counter field.
 * @returns Arrow function that increments the counter and resolves.
 */
function makeRouteAbortFn(abortCount: { value: number }): () => Promise<true> {
  return (): Promise<true> => {
    abortCount.value += 1;
    return Promise.resolve(true);
  };
}

/**
 * Build the page route stub methods with handler capture.
 *
 * @param slot - Mutable slot that stores the captured route handler.
 * @returns Object with route + unroute methods for the page stub.
 */
function makeRouteCallback(
  slot: IHandlerSlot,
): (_pattern: string, handler: RouteHandler) => Promise<true> {
  return (_pattern: string, handler: RouteHandler): Promise<true> => {
    slot.fn = handler;
    return Promise.resolve(true);
  };
}

/**
 * Build the unroute callback for a Page stub.
 * @returns Unroute callback.
 */
function makeUnrouteCallback(): () => Promise<true> {
  return (): Promise<true> => Promise.resolve(true);
}

/**
 * Build the page route stub methods with handler capture.
 *
 * @param slot - Mutable slot that stores the captured route handler.
 * @returns Object with route + unroute methods for the page stub.
 */
function buildPageRouteMethods(slot: IHandlerSlot): IPageRouteMethods {
  const route = makeRouteCallback(slot);
  const unroute = makeUnrouteCallback();
  return { route, unroute };
}

/**
 * Build the page route stub that captures the installed handler.
 *
 * @param slot - Mutable slot that stores the captured route handler.
 * @returns Page stub shaped object with route + unroute.
 */
function makePageRouteStub(slot: IHandlerSlot): object {
  return buildPageRouteMethods(slot);
}

/**
 * Build the invoke helper that calls the captured route handler.
 *
 * @param slot - Slot holding the captured handler reference.
 * @returns Function that dispatches to the captured handler.
 */
function makeHandlerInvoker(slot: IHandlerSlot): (route: Route, req: Request) => Promise<unknown> {
  return (route: Route, req: Request): Promise<unknown> => {
    const fn = slot.fn;
    if (fn === undefined) throw new ScraperError('route handler not yet captured');
    return fn(route, req);
  };
}

/**
 * Build a Page stub that captures the handler passed to page.route().
 *
 * @returns Capture exposing the page stub + an invoke helper.
 */
function makePageCapture(): IRouteCapture {
  const slot: IHandlerSlot = { fn: undefined };
  return { page: makePageRouteStub(slot) as unknown as Page, invoke: makeHandlerInvoker(slot) };
}

/**
 * Build a Route stub that records fulfill + abort calls.
 *
 * @returns Stub exposing route + ledgers.
 */
function makeRoute(): IRouteStub {
  const fulfilled: IFulfillCapture[] = [];
  const abortCount = { value: 0 };
  const stub = { fulfill: makeRouteFulfillFn(fulfilled), abort: makeRouteAbortFn(abortCount) };
  return { route: stub as unknown as Route, fulfilled, abortCount };
}

/**
 * Build the method accessor fields for a Request stub.
 *
 * @param spec - Spec data the stub should return.
 * @returns Plain object with the harvester-used request accessors.
 */
function makeRequestUrl(spec: IRequestSpec): () => string {
  return (): string => spec.url;
}

/**
 * Build the HTTP method accessor for a Request stub.
 * @param spec - Request fixture spec.
 * @returns Method accessor.
 */
function makeRequestMethod(spec: IRequestSpec): () => string {
  return (): string => spec.method;
}

/**
 * Build the resource type accessor for a Request stub.
 * @param spec - Request fixture spec.
 * @returns Resource type accessor.
 */
function makeRequestResourceType(spec: IRequestSpec): () => string {
  return (): string => spec.resourceType;
}

/**
 * Build the post body accessor for a Request stub.
 * @param spec - Request fixture spec.
 * @returns Post body accessor.
 */
function makeRequestPostData(spec: IRequestSpec): () => string {
  return (): string => spec.postBody ?? '';
}

/**
 * Build the header accessor for a Request stub.
 * @param spec - Request fixture spec.
 * @returns Header accessor.
 */
function makeRequestHeaders(spec: IRequestSpec): () => Record<string, string> {
  return (): Record<string, string> => ({ ...(spec.headers ?? {}) });
}

/**
 * Build the method accessor fields for a Request stub.
 *
 * @param spec - Spec data the stub should return.
 * @returns Plain object with the harvester-used request accessors.
 */
function buildRequestStubFields(spec: IRequestSpec): IRequestStubFields {
  const url = makeRequestUrl(spec);
  const method = makeRequestMethod(spec);
  const resourceType = makeRequestResourceType(spec);
  const postData = makeRequestPostData(spec);
  const headers = makeRequestHeaders(spec);
  return { url, method, resourceType, postData, headers };
}

/**
 * Build a Request stub that returns the supplied facts.
 *
 * @param spec - Method, URL, resource type, optional body and headers.
 * @returns Request stub.
 */
function makeRequest(spec: IRequestSpec): Request {
  return buildRequestStubFields(spec) as unknown as Request;
}

describe('installSimulator — happy path advance', () => {
  it('advances phases and fulfils with the captured body', async () => {
    const fixtures = setupFixtures(MANIFEST_SIMPLE, FIXTURES_OK);
    try {
      const capture = makePageCapture();
      const handle = await installSimulator({
        page: capture.page,
        bankId: BANK_ID,
        fixturesRoot: fixtures.fixturesRoot,
      });
      const initRoute = makeRoute();
      const initReq = makeRequest({
        url: 'https://x/init',
        method: 'GET',
        resourceType: 'document',
      });
      await capture.invoke(initRoute.route, initReq);
      const homeRoute = makeRoute();
      const homeReq = makeRequest({
        url: 'https://x/home',
        method: 'GET',
        resourceType: 'document',
      });
      await capture.invoke(homeRoute.route, homeReq);
      const snap = handle.snapshot();
      expect(snap.currentPhase).toBe('PRE_LOGIN');
      expect(snap.transitionsFired).toBe(2);
      const initBodyText = initRoute.fulfilled[0].body.toString('utf8');
      const homeBodyText = homeRoute.fulfilled[0].body.toString('utf8');
      expect(initBodyText).toBe('<html>init</html>');
      expect(homeBodyText).toBe(HOME_BODY);
    } finally {
      fixtures.cleanup();
    }
  });
});

describe('installSimulator — OTP_TRIGGER mints Set-Cookie nonce', () => {
  it('injects integ_otp_challenge cookie in the response', async () => {
    const fixtures = setupFixtures(MANIFEST_OTP, FIXTURES_OK);
    try {
      const capture = makePageCapture();
      await installSimulator({
        page: capture.page,
        bankId: BANK_ID,
        fixturesRoot: fixtures.fixturesRoot,
      });
      const triggerRoute = makeRoute();
      const triggerReq = makeRequest({
        url: 'https://x/otp/send',
        method: 'POST',
        resourceType: 'fetch',
        postBody: '',
      });
      await capture.invoke(triggerRoute.route, triggerReq);
      const setCookie = triggerRoute.fulfilled[0].headers['set-cookie'];
      expect(setCookie).toMatch(/^integ_otp_challenge=otp-[a-z0-9]{9}; Path=\/$/);
    } finally {
      fixtures.cleanup();
    }
  });
});

describe('installSimulator — OTP_FILL nonce binding', () => {
  it('accepts the OTP_FILL submission with matching code + cookie nonce', async () => {
    const fixtures = setupFixtures(MANIFEST_OTP, FIXTURES_OK);
    try {
      const capture = makePageCapture();
      const handle = await installSimulator({
        page: capture.page,
        bankId: BANK_ID,
        fixturesRoot: fixtures.fixturesRoot,
      });
      const triggerRoute = makeRoute();
      const triggerReq = makeRequest({
        url: 'https://x/otp/send',
        method: 'POST',
        resourceType: 'fetch',
        postBody: '',
      });
      await capture.invoke(triggerRoute.route, triggerReq);
      const setCookie = triggerRoute.fulfilled[0].headers['set-cookie'];
      const cookieFirstPart = setCookie.split(';')[0];
      const noncePart = cookieFirstPart.split('=')[1];
      const fillRoute = makeRoute();
      const fillBody = JSON.stringify({ code: '123456' });
      const fillReq = makeRequest({
        url: 'https://x/otp/verify',
        method: 'POST',
        resourceType: 'fetch',
        postBody: fillBody,
        headers: { cookie: `integ_otp_challenge=${noncePart}` },
      });
      await capture.invoke(fillRoute.route, fillReq);
      expect(handle.snapshot().currentPhase).toBe('AUTH_DISCOVERY');
    } finally {
      fixtures.cleanup();
    }
  });

  it('rejects the OTP_FILL submission when the nonce is missing', async () => {
    const fixtures = setupFixtures(MANIFEST_OTP, FIXTURES_OK);
    try {
      const capture = makePageCapture();
      await installSimulator({
        page: capture.page,
        bankId: BANK_ID,
        fixturesRoot: fixtures.fixturesRoot,
      });
      const triggerRoute = makeRoute();
      const triggerReq = makeRequest({
        url: 'https://x/otp/send',
        method: 'POST',
        resourceType: 'fetch',
        postBody: '',
      });
      await capture.invoke(triggerRoute.route, triggerReq);
      const fillRoute = makeRoute();
      const fillBody = JSON.stringify({ code: '123456' });
      const fillReq = makeRequest({
        url: 'https://x/otp/verify',
        method: 'POST',
        resourceType: 'fetch',
        postBody: fillBody,
      });
      const invocation = capture.invoke(fillRoute.route, fillReq);
      await expect(invocation).rejects.toThrow(/OTP_FILL rejected/);
    } finally {
      fixtures.cleanup();
    }
  });
});

describe('installSimulator — escape classification', () => {
  it('records a fatal escape for an unmatched document request', async () => {
    const fixtures = setupFixtures(MANIFEST_SIMPLE, FIXTURES_OK);
    try {
      const capture = makePageCapture();
      const handle = await installSimulator({
        page: capture.page,
        bankId: BANK_ID,
        fixturesRoot: fixtures.fixturesRoot,
      });
      const escapeRoute = makeRoute();
      const escapeReq = makeRequest({
        url: 'https://x/unknown',
        method: 'GET',
        resourceType: 'document',
      });
      await capture.invoke(escapeRoute.route, escapeReq);
      const snap = handle.snapshot();
      expect(snap.fatalEscapes).toHaveLength(1);
      expect(snap.fatalEscapes[0].url).toBe('https://x/unknown');
      expect(escapeRoute.abortCount.value).toBe(1);
    } finally {
      fixtures.cleanup();
    }
  });

  it('aborts benign image requests without recording fatal', async () => {
    const fixtures = setupFixtures(MANIFEST_SIMPLE, FIXTURES_OK);
    try {
      const capture = makePageCapture();
      const handle = await installSimulator({
        page: capture.page,
        bankId: BANK_ID,
        fixturesRoot: fixtures.fixturesRoot,
      });
      const benignRoute = makeRoute();
      const benignReq = makeRequest({
        url: 'https://x/favicon.png',
        method: 'GET',
        resourceType: 'image',
      });
      await capture.invoke(benignRoute.route, benignReq);
      const snap = handle.snapshot();
      expect(snap.fatalEscapes).toHaveLength(0);
      expect(snap.benignAbortCount).toBe(1);
      expect(benignRoute.abortCount.value).toBe(1);
    } finally {
      fixtures.cleanup();
    }
  });
});

describe('installSimulator — ambiguous manifest', () => {
  it('throws when two same-phase transitions both match', async () => {
    const fixtures = setupFixtures(MANIFEST_AMBIGUOUS, FIXTURES_OK);
    try {
      const capture = makePageCapture();
      await installSimulator({
        page: capture.page,
        bankId: BANK_ID,
        fixturesRoot: fixtures.fixturesRoot,
      });
      const r = makeRoute();
      const req = makeRequest({ url: 'https://x/init', method: 'GET', resourceType: 'document' });
      const invocation = capture.invoke(r.route, req);
      await expect(invocation).rejects.toThrow(/ambiguous manifest match/);
    } finally {
      fixtures.cleanup();
    }
  });
});

describe('installSimulator — backward transition guard', () => {
  it('rejects a transition that tries to walk backward in PHASE_CHAIN', async () => {
    const fixtures = setupFixtures(MANIFEST_BACKWARD, FIXTURES_OK);
    try {
      const capture = makePageCapture();
      await installSimulator({
        page: capture.page,
        bankId: BANK_ID,
        fixturesRoot: fixtures.fixturesRoot,
      });
      const r = makeRoute();
      const req = makeRequest({ url: 'https://x/back', method: 'GET', resourceType: 'document' });
      const invocation = capture.invoke(r.route, req);
      await expect(invocation).rejects.toThrow(/backward transition rejected/);
    } finally {
      fixtures.cleanup();
    }
  });
});
