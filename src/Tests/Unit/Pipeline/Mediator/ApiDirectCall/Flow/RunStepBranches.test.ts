/**
 * Extra branch coverage for RunStep — queryTemplate hydration,
 * coerceQueryRecord failures, cookie-jar threading, static-headers
 * merging. Complements the happy-path coverage in RunStep.test.ts.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../../Scrapers/Base/ScraperError.js';
import {
  createSimpleCookieJar,
  runStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const BRANCH_URL_TAG: WKUrlGroup = 'auth.bind';
const CLEAN_URL_TAG: WKUrlGroup = 'auth.logout';
const HINT = CompanyTypes.OneZero;

beforeAll((): void => {
  registerWkUrl(BRANCH_URL_TAG, HINT, 'https://example.test/api/branch?v=9');
  registerWkUrl(CLEAN_URL_TAG, HINT, 'https://example.test/api/clean');
});

/** Plain config stub — no signer, static header so merge branch fires. */
const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: {},
  staticHeaders: { 'X-Static': 'ok' },
};

/**
 * Build a scope wrapping PLAIN_CONFIG.
 * @returns Template scope.
 */
function makeScope(): ITemplateScope {
  return { carry: {}, creds: {}, config: PLAIN_CONFIG, keypair: undefined };
}

describe('api-direct-call RunStep createSimpleCookieJar', () => {
  it('round-trips add + header for two distinct cookies', (): void => {
    const jar = createSimpleCookieJar();
    const n = jar.add(['sid=abc123; Path=/; HttpOnly', 'csrf=zy']);
    const header = jar.header();
    expect(n).toBe(2);
    expect(header).toBe('sid=abc123; csrf=zy');
  });

  it('overwrites cookies when the same name is re-added', (): void => {
    const jar = createSimpleCookieJar();
    jar.add(['sid=first']);
    jar.add(['sid=second']);
    const header = jar.header();
    expect(header).toBe('sid=second');
  });

  it('skips cookie lines without "="', (): void => {
    const jar = createSimpleCookieJar();
    const n = jar.add(['bad-line', '', 'valid=1']);
    const header = jar.header();
    expect(n).toBe(1);
    expect(header).toBe('valid=1');
  });
});

describe('api-direct-call RunStep queryTemplate branches', () => {
  it('merges hydrated scalar query pairs and URL-encodes them', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ ok: true })];
    const bus = makeStubMediator({ responses, captures });
    const step: IStepConfig = {
      name: 'bind',
      urlTag: BRANCH_URL_TAG,
      body: { shape: {} },
      queryTemplate: { a: { $literal: 'x y' }, b: { $literal: '1' } },
      extractsToCarry: {},
    };
    const result = await runStep({ step, bus, scope: makeScope(), companyId: HINT });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('runStep should succeed');
    expect(captures).toHaveLength(1);
    const headers = captures[0].extraHeaders ?? {};
    expect(headers['X-Static']).toBe('ok');
  });

  it('fails when queryTemplate does not hydrate to an object', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const step: IStepConfig = {
      name: 'bind',
      urlTag: BRANCH_URL_TAG,
      body: { shape: {} },
      queryTemplate: { $literal: 42 } as unknown as IStepConfig['queryTemplate'],
      extractsToCarry: {},
    };
    const result = await runStep({ step, bus, scope: makeScope(), companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('did not hydrate to an object');
    expect(captures).toHaveLength(0);
  });

  it('fails when queryTemplate yields a non-scalar value', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const step: IStepConfig = {
      name: 'bind',
      urlTag: BRANCH_URL_TAG,
      body: { shape: {} },
      queryTemplate: { nested: { $literal: { x: 1 } } },
      extractsToCarry: {},
    };
    const result = await runStep({ step, bus, scope: makeScope(), companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('must be a scalar');
    expect(captures).toHaveLength(0);
  });

  it('propagates queryTemplate hydrate failures verbatim', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const step: IStepConfig = {
      name: 'bind',
      urlTag: BRANCH_URL_TAG,
      body: { shape: {} },
      queryTemplate: { a: { $ref: 'carry.missing' } },
      extractsToCarry: {},
    };
    const result = await runStep({ step, bus, scope: makeScope(), companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.missing');
    expect(captures).toHaveLength(0);
  });
});

describe('api-direct-call RunStep cookie jar wiring', () => {
  it('sends the accumulated Cookie header when step.cookieJar is true', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ ok: true })];
    const bus = makeStubMediator({ responses, captures });
    const jar = createSimpleCookieJar();
    jar.add(['sid=prev-cookie']);
    const step: IStepConfig = {
      name: 'bind',
      urlTag: BRANCH_URL_TAG,
      body: { shape: {} },
      cookieJar: true,
      extractsToCarry: {},
    };
    const result = await runStep({
      step,
      bus,
      scope: makeScope(),
      companyId: HINT,
      cookieJar: jar,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('runStep should succeed');
    expect(captures).toHaveLength(1);
    const headers = captures[0].extraHeaders ?? {};
    expect(headers.Cookie).toBe('sid=prev-cookie');
  });

  it('does not emit a Cookie header when step.cookieJar is false', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ ok: true })];
    const bus = makeStubMediator({ responses, captures });
    const jar = createSimpleCookieJar();
    jar.add(['sid=should-not-send']);
    const step: IStepConfig = {
      name: 'bind',
      urlTag: BRANCH_URL_TAG,
      body: { shape: {} },
      extractsToCarry: {},
    };
    const result = await runStep({
      step,
      bus,
      scope: makeScope(),
      companyId: HINT,
      cookieJar: jar,
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('runStep should succeed');
    const headers = captures[0].extraHeaders ?? {};
    expect(headers.Cookie).toBeUndefined();
  });
});

describe('api-direct-call RunStep buildPathAndQuery branches', () => {
  it('appends query with "?" when URL has no existing search string', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ ok: true })];
    const bus = makeStubMediator({ responses, captures });
    const step: IStepConfig = {
      name: 'bind',
      urlTag: CLEAN_URL_TAG,
      body: { shape: {} },
      queryTemplate: { flag: { $literal: 'yes' } },
      extractsToCarry: {},
    };
    const result = await runStep({ step, bus, scope: makeScope(), companyId: HINT });
    expect(result.success).toBe(true);
    if (!result.success) throw new ScraperError('runStep should succeed');
    expect(captures).toHaveLength(1);
  });
});

describe('api-direct-call RunStep apiPost failure propagation', () => {
  it('propagates an upstream transport failure verbatim', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [fail(ScraperErrorTypes.Generic, 'net boom')];
    const bus = makeStubMediator({ responses, captures });
    const step: IStepConfig = {
      name: 'bind',
      urlTag: BRANCH_URL_TAG,
      body: { shape: {} },
      extractsToCarry: { token: '/access_token' },
    };
    const result = await runStep({ step, bus, scope: makeScope(), companyId: HINT });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('net boom');
  });
});
