/**
 * PayBox post-login request-body contract.
 *
 * <p>PayBox carries no `Authorization` header after login, so the
 * DATA calls identify themselves through a class-y `auth: { … }` body
 * envelope. `T-PB-BODY-2` asserts every data step carries a populated
 * one, so a step added later that forgets it fails here rather than in
 * a live E2E run.
 *
 * <p><b>The balance call (`/sync`) is the exception</b> and
 * `T-PB-BODY-3` pins it: it must ship `{}`. PayBox answers it 400
 * either way, but a rejected body carrying the live `access_token`
 * makes PayBox invalidate the session — forensic run 31015484475 shows
 * `/getUserHistory` returning `401 UNAUTHORIZED` 355 ms later. A
 * regression that "fixed" `/sync` by adding the envelope cost a full
 * release cycle.
 *
 * <p>The gap this file closes is that the phase-level integration test
 * stubs `apiPost` as `(urlTag) => route(urlTag)` and therefore never
 * inspects the body it was handed. Asserting the shape of the REQUEST —
 * not just the handling of the RESPONSE — is what pins both halves of
 * the contract.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { PAYBOX_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShape.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { createApiDirectScrapePhase } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';

const FIXT_UID = 'pb-uid-fixture-1';
const FIXT_DEVICE = 'fixt-device-pb-0001';
const FIXT_TOKEN = 'fixt-jwt-pb-0001';

/** Session-context the ApiDirectCall phase deposits before scrape runs. */
const PAYBOX_SESSION: Readonly<Record<string, unknown>> = Object.freeze({
  uId: FIXT_UID,
  deviceId16Hex: FIXT_DEVICE,
  token: FIXT_TOKEN,
});

/**
 * The balance URL tag, read from the production shape rather than
 * restated here — a test that hardcodes it would keep passing if the
 * shape moved the balance call to another endpoint. PayBox declares it
 * as a literal; a function form would mean the tag is per-account and
 * this whole file's premise no longer holds, so fail loudly.
 */
const RAW_BALANCE_TAG: unknown = PAYBOX_SHAPE.balance.urlTag;
if (typeof RAW_BALANCE_TAG !== 'string') {
  throw new TypeError('PAYBOX_SHAPE.balance.urlTag must be a literal tag');
}
const BALANCE_URL_TAG: string = RAW_BALANCE_TAG;

/** Envelope fields that carry caller identity — must never be blank. */
const IDENTITY_FIELDS = ['uId', 'uuid', 'access_token'] as const;

/** Envelope fields sourced from PAYBOX_AUTH_ENVELOPE_DEFAULTS. */
const CLIENT_FIELDS = ['appVer', 'type', 'os'] as const;

/** One recorded apiPost dispatch. */
interface ICapturedCall {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

/**
 * Canned responses keyed by URL tag — shaped to satisfy the real
 * PayBox extractors so the phase completes its full walk.
 * @param url - WK URL tag apiPost was called with.
 * @returns Procedure the stub resolves with.
 */
function respondTo(url: string): Procedure<unknown> {
  if (url === 'data.sync') return succeed({ content: { userFunds: { balance: 100 } } });
  // A row whose `ts` equals the first-page sentinel stalls the cursor,
  // terminating pagination after one fetch.
  if (url === 'data.getUserHistory') return succeed({ content: { nc: [{ ts: 'null' }] } });
  return fail(ScraperErrorTypes.Generic, `unexpected url=${url}`);
}

/**
 * Build a mediator that records the body of every apiPost dispatch.
 * @param sink - Array each dispatched call is appended to.
 * @returns Mock mediator.
 */
function makeRecordingBus(sink: ICapturedCall[]): IApiMediator {
  const apiPost = jest.fn(async (url: string, body: unknown): Promise<Procedure<unknown>> => {
    await Promise.resolve();
    sink.push({ url, body: (body ?? {}) as Record<string, unknown> });
    return respondTo(url);
  });
  return {
    apiPost,
    apiGet: jest.fn(),
    apiQuery: jest.fn(),
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    setSessionContext: jest.fn(),
    ...makeRecoverySessionStubs(),
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => PAYBOX_SESSION),
  } as unknown as IApiMediator;
}

/**
 * Read the `auth` envelope off a captured body.
 * @param call - Recorded dispatch.
 * @returns Envelope record (empty when absent or not an object).
 */
function authOf(call: ICapturedCall): Record<string, unknown> {
  const auth = call.body.auth;
  if (auth === null || typeof auth !== 'object') return {};
  return auth as Record<string, unknown>;
}

/**
 * Stand-in returned when a URL tag was never dispatched. The preceding
 * `expect(found).toBeDefined()` is what reports the miss; this keeps the
 * helper total so no assertion nor type escape hatch is needed.
 */
const MISSING_CALL: ICapturedCall = { url: '(not dispatched)', body: {} };

/**
 * Locate the recorded dispatch for a URL tag.
 * @param calls - All recorded dispatches.
 * @param url - WK URL tag to find.
 * @returns The matching call.
 */
function callFor(calls: readonly ICapturedCall[], url: string): ICapturedCall {
  const found = calls.find(c => c.url === url);
  expect(found).toBeDefined();
  return found ?? MISSING_CALL;
}

/**
 * Every recorded dispatch that is not the balance call — the post-login
 * data steps, derived from what the shape actually dispatched rather
 * than from a hardcoded tag list that could drift from production.
 * @param calls - All recorded dispatches.
 * @returns Data-step dispatches.
 */
function dataCalls(calls: readonly ICapturedCall[]): readonly ICapturedCall[] {
  return calls.filter(c => c.url !== BALANCE_URL_TAG);
}

describe('PayBox post-login body contract', () => {
  let calls: ICapturedCall[] = [];

  beforeAll(async () => {
    calls = [];
    const bus = makeRecordingBus(calls);
    const overrides: Partial<IPipelineContext> = { apiMediator: some(bus) };
    const ctx = makeMockContext(overrides) as unknown as IActionContext;
    const phase = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const result = await phase(ctx);
    assertOk(result);
  });

  it('T-PB-BODY-1 dispatches the balance step and at least one data step', () => {
    const urls = calls.map(c => c.url);
    expect(urls).toContain(BALANCE_URL_TAG);
    expect(dataCalls(calls).length).toBeGreaterThan(0);
  });

  // The regression net. `/sync` shipped a body with no identity for ten
  // weeks; this fails the moment a data step does so again.
  it('T-PB-BODY-2 every data step carries a populated auth envelope', () => {
    const steps = dataCalls(calls);
    // Without this the loop below passes vacuously if the shape ever
    // stops dispatching a data step — the exact failure it must catch.
    expect(steps.length).toBeGreaterThan(0);
    for (const call of steps) {
      const auth = authOf(call);
      for (const field of IDENTITY_FIELDS) {
        expect(typeof auth[field]).toBe('string');
        expect(auth[field]).not.toBe('');
      }
      for (const field of CLIENT_FIELDS) expect(auth[field]).not.toBe('');
    }
  });

  // The counter-regression net, and the more expensive one to get wrong.
  // `/sync` is answered with HTTP 400 whatever the body holds, but a 400
  // on a body carrying the live `access_token` makes PayBox invalidate
  // the session — the next `/getUserHistory` then returns
  // `401 UNAUTHORIZED` instead of rows (forensic run 31015484475, 0 txns
  // against 88 in the preceding green run 30977091315).
  it('T-PB-BODY-3 the balance step carries NO auth envelope', () => {
    const syncCall = callFor(calls, BALANCE_URL_TAG);
    expect(syncCall.body).not.toHaveProperty('auth');
  });

  it('T-PB-BODY-4 identity fields are sourced from the live session-context', () => {
    const [dataCall] = dataCalls(calls);
    const auth = authOf(dataCall);
    expect(auth.uId).toBe(FIXT_UID);
    expect(auth.uuid).toBe(FIXT_DEVICE);
    expect(auth.access_token).toBe(FIXT_TOKEN);
  });
});
