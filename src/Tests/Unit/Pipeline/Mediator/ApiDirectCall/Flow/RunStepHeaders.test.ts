/**
 * E3 — per-step header templates.
 *
 * A step's `headers` are hydrated against the step scope on every call, sent
 * as text, and replace a static header of the same name whatever its case.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
  JsonValueTemplate,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const HINT = CompanyTypes.OneZero;
const UUID_SHAPE = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/;

const CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
  staticHeaders: { 'X-Site': 'static', 'X-Keep': 'kept' },
};

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, 'https://example.test/api/bind');
});

/**
 * A bind step carrying the given header templates.
 * @param headers - Step header templates.
 * @returns Step config.
 */
function stepWith(headers: Readonly<Record<string, JsonValueTemplate>>): IStepConfig {
  return { name: 'bind', urlTag: 'auth.bind', body: { shape: {} }, headers, extractsToCarry: {} };
}

/**
 * Run a step once on a stub bus that answers OK.
 * @param step - Step config.
 * @param captures - Capture slot for the POST.
 * @returns The step result.
 */
function runOnce(step: IStepConfig, captures: IApiPostCapture[]): Promise<Procedure<unknown>> {
  const responses = [succeed({})];
  const bus = makeStubMediator({ responses, captures });
  const carry = { bcKey: 'syn-bc-1' };
  const scope: ITemplateScope = { carry, creds: {}, config: CONFIG, keypair: undefined };
  return runStep({ step, bus, scope, companyId: HINT });
}

/**
 * Run a step once and return the headers it sent.
 * @param step - Step config.
 * @returns The sent header map ({} when none was sent).
 */
async function sentHeaders(step: IStepConfig): Promise<Record<string, string>> {
  const captures: IApiPostCapture[] = [];
  await runOnce(step, captures);
  return captures[0].extraHeaders ?? {};
}

describe('E3 step header templates', () => {
  it('resolves a carry ref for the call', async (): Promise<void> => {
    const step = stepWith({ 'X-Bc-Key': { $ref: 'carry.bcKey' } });
    const headers = await sentHeaders(step);
    expect(headers).toEqual({ 'X-Site': 'static', 'X-Keep': 'kept', 'X-Bc-Key': 'syn-bc-1' });
  });

  it('sends a fresh uuid on every call', async (): Promise<void> => {
    const step = stepWith({ 'X-Request-Id': { $ref: 'uuid' } });
    const first = await sentHeaders(step);
    const second = await sentHeaders(step);
    const ids = [first['X-Request-Id'], second['X-Request-Id']];
    expect(ids).toEqual([expect.stringMatching(UUID_SHAPE), expect.stringMatching(UUID_SHAPE)]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('sends a non-string value as its JSON text', async (): Promise<void> => {
    const step = stepWith({ 'X-Version': { $literal: 7 }, 'X-Mobile': { $literal: true } });
    const headers = await sentHeaders(step);
    expect(headers).toMatchObject({ 'X-Version': '7', 'X-Mobile': 'true' });
  });

  it('replaces a static header whatever its case', async (): Promise<void> => {
    const step = stepWith({ 'x-site': { $literal: 'step' } });
    const headers = await sentHeaders(step);
    expect(headers).toEqual({ 'X-Keep': 'kept', 'x-site': 'step' });
  });

  it('fails the step before sending when a header ref is missing', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const step = stepWith({ 'X-Bc-Key': { $ref: 'carry.absent' } });
    const result = await runOnce(step, captures);
    expect(captures).toEqual([]);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'ref carry.absent missing from scope.carry',
    });
  });
});
