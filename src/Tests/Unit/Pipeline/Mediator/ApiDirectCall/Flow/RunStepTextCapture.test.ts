/**
 * A `text` step's captures run on its real `{ text }` answer through the
 * headless native transport. Each pattern must match exactly once and its slot
 * takes the group's text; an `absent` guard must not match and carries nothing.
 * A captured slot passes its extract rules, `maxChars` 8192 when it has none.
 * `maxTextChars` moves the answer cap. A failure names the step and the slot,
 * never the text.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
  ITextCapture,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fakeFetch } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';
const SECRET = 'syn-code-7f3a';
const SSO: ITextCapture = { pattern: String.raw`^[\s\S]*?code=([\s\S]+)$`, group: 1 };
const CSRF: ITextCapture = { pattern: 'csrfToken', group: 0, absent: true };

const CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

/** One capture case: its label, capture, answer text and expected outcome. */
interface ICaptureCase {
  readonly label: string;
  readonly capture: ITextCapture;
  readonly body: string;
  readonly expected: string;
}

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, `${ORIGIN}/api/bootstrap`);
});

/**
 * A text GET step with the given extra fields.
 * @param extra - Fields over the base step.
 * @returns GET step.
 */
function textStep(extra: Partial<IGetStep>): IGetStep {
  const base: IGetStep = {
    name: 'bootstrap',
    urlTag: 'auth.bind',
    method: 'GET',
    response: 'text',
    extractsToCarry: {},
  };
  return { ...base, ...extra };
}

/**
 * Run one step against a fake answering every call with `body`.
 * @param step - The step.
 * @param body - Answer text.
 * @returns The step's result.
 */
async function runOn(step: IGetStep, body: string): Promise<Procedure<ITemplateScope>> {
  const fake = fakeFetch((): Response => new Response(body, { status: 200 }));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  const bus = makeNativeMediator(HINT, ORIGIN);
  const scope: ITemplateScope = { carry: {}, creds: {}, config: CONFIG, keypair: undefined };
  return runStep({ step, bus, scope, companyId: HINT });
}

describe('text captures on a text step', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('takes the whole rest after the first code= for the SSO capture', async () => {
    const step = textStep({ textCaptures: { ssoCode: SSO } });
    const result = await runOn(step, `{"a":1}\nnext?code=${SECRET}&code=2\n`);
    const ssoCode = `${SECRET}&code=2\n`;
    expect(result).toMatchObject({ success: true, value: { carry: { ssoCode } } });
  });

  it.each<ICaptureCase>([
    {
      label: 'group 0, the whole match',
      capture: { pattern: String.raw`<app-root\b`, group: 0 },
      body: '<p><app-root ng>',
      expected: '<app-root',
    },
    {
      label: 'a back-referenced value',
      capture: { pattern: String.raw`\bbankNum\s*=\s*(["'])([^"']*)\1`, group: 2 },
      body: "x bankNum = '31';",
      expected: '31',
    },
  ])('carries $label', async ({ capture, body, expected }) => {
    const step = textStep({ textCaptures: { slot: capture } });
    const result = await runOn(step, body);
    expect(result).toMatchObject({ success: true, value: { carry: { slot: expected } } });
  });

  it.each<ICaptureCase>([
    { label: 'no match', capture: SSO, body: 'no token here', expected: 'missing' },
    {
      label: 'an unset group',
      capture: { pattern: '(a)?b', group: 1 },
      body: 'xb',
      expected: 'missing',
    },
    {
      label: 'a second match',
      capture: { pattern: String.raw`id=(\d+)`, group: 1 },
      body: 'id=1 id=73',
      expected: 'ambiguous',
    },
    {
      label: 'an empty pattern matching twice',
      capture: { pattern: 'x*', group: 0 },
      body: 'ab',
      expected: 'ambiguous',
    },
  ])('fails on $label, naming the slot only', async ({ capture, body, expected }) => {
    const step = textStep({ textCaptures: { slot: capture } });
    const result = await runOn(step, body);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: `bootstrap capture slot ${expected}`,
    });
  });

  it('passes an absent guard on no match and carries nothing', async () => {
    const step = textStep({ textCaptures: { csrf: CSRF, ssoCode: SSO } });
    const result = await runOn(step, `code=${SECRET}`);
    expect(result).toMatchObject({ success: true, value: { carry: { ssoCode: SECRET } } });
    const carry = result.success ? result.value.carry : {};
    expect(carry).not.toHaveProperty('csrf');
  });

  it('fails an absent guard once its pattern matches', async () => {
    const step = textStep({ textCaptures: { csrf: CSRF } });
    const result = await runOn(step, `var csrfToken = "${SECRET}";`);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'bootstrap capture csrf present',
    });
  });

  it('refuses an unruled capture over 8192 chars', async () => {
    const step = textStep({ textCaptures: { ssoCode: SSO } });
    const long = 'a'.repeat(8193);
    const result = await runOn(step, `code=${long}`);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'bootstrap extract ssoCode invalid',
    });
  });

  it("checks a capture against its slot's own rule", async () => {
    const rule = { maxChars: 32_768, pattern: String.raw`^[^\s#<>"']+$` };
    const step = textStep({ textCaptures: { ssoCode: SSO }, extractRules: { ssoCode: rule } });
    const passed = await runOn(step, `code=${'a'.repeat(9000)}`);
    expect(passed).toMatchObject({ success: true });
    const refused = await runOn(step, 'code= spaced');
    expect(refused).toMatchObject({
      success: false,
      errorMessage: 'bootstrap extract ssoCode invalid',
    });
  });

  it('accepts an answer over 65 536 chars under a raised maxTextChars', async () => {
    const step = textStep({ maxTextChars: 70_000, textCaptures: { ssoCode: SSO } });
    const body = `${'a'.repeat(65_536)}code=${SECRET}`;
    const result = await runOn(step, body);
    expect(result).toMatchObject({ success: true, value: { carry: { ssoCode: SECRET } } });
  });

  it('takes an answer at a lowered maxTextChars and refuses one char over it', async () => {
    const step = textStep({ maxTextChars: 10, textCaptures: { ssoCode: SSO } });
    const atCap = await runOn(step, 'code=abcde');
    expect(atCap).toMatchObject({ success: true, value: { carry: { ssoCode: 'abcde' } } });
    const overCap = await runOn(step, 'code=abcdef');
    expect(overCap).toMatchObject({ success: false, errorMessage: 'bootstrap text too long' });
  });
});
