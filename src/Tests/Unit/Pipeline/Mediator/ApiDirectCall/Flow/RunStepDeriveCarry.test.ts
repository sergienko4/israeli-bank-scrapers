/**
 * A step may derive carry slots after its extracts. `deriveCarry` runs
 * the flow-init derivation evaluator over the step's merged scope: body and
 * header extracts of this step, earlier carry, creds and `config.secrets`.
 * An op shapes the text last; a failed `format` names the step.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
  RefToken,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { HeaderPair } from '../../../../../Helpers/NativeStepHarness.js';
import { installJsonAnswer, makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';

const SECRETS_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
  secrets: { wrapPrefix: 'syn-pre-', wrapSuffix: '-syn-post' },
};

const ANSWER_BODY = { xsrfToken: 'syn-xsrf', modulus: 'syn-mod' };

const ANSWER_HEADERS: readonly HeaderPair[] = [['serid', 'syn-serid']];

/** The slots the base step extracts before deriving a new one. */
const PRESERVED = { xsrfToken: 'syn-xsrf', modulus: 'syn-mod', serid: 'syn-serid' } as const;

const BASE_STEP: IGetStep = {
  name: 'bind',
  urlTag: 'auth.bind',
  method: 'GET',
  extractsToCarry: { xsrfToken: '/xsrfToken', modulus: '/modulus' },
  headerExtractsToCarry: { serid: { header: 'serid' } },
};

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, `${ORIGIN}/api/bind`);
});

/**
 * Build a template scope over the secrets config.
 * @returns Template scope.
 */
function makeScope(): ITemplateScope {
  return { carry: {}, creds: {}, config: SECRETS_CONFIG, keypair: undefined };
}

/**
 * Run the base step with these derivations against the stock answer.
 * @param deriveCarry - The step's derivations.
 * @param carry - Earlier carry slots.
 * @returns The step's result.
 */
function runDerive(
  deriveCarry: IGetStep['deriveCarry'],
  carry: Readonly<Record<string, string>> = {},
): ReturnType<typeof runStep> {
  installJsonAnswer(ANSWER_BODY, ANSWER_HEADERS);
  const step: IGetStep = { ...BASE_STEP, deriveCarry };
  const bus = makeNativeMediator(HINT, ORIGIN);
  const scope = { ...makeScope(), carry };
  return runStep({ step, bus, scope, companyId: HINT });
}

/**
 * Derive a tracking value from one synthetic entry URL.
 * @param url - Source URL.
 * @returns The step result.
 */
function runQuery(url: string): ReturnType<typeof runStep> {
  const op = { kind: 'url-query', key: 'tracking' } as const;
  const derive = { into: 'tracking', parts: ['carry.entry'] as const, op };
  return runDerive([derive], { entry: url });
}

describe('step-level derived carry', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('UT-DV-01 joins a body extract and a header extract with a separator', async () => {
    const parts: readonly RefToken[] = ['carry.xsrfToken', 'carry.serid'];
    const result = await runDerive([{ into: 'composite', parts, separator: '###3' }]);
    const composite = 'syn-xsrf###3syn-serid';
    expect(result).toMatchObject({
      success: true,
      value: { carry: { composite, ...PRESERVED } },
    });
  });

  it('UT-DV-02 wraps an extract in config.secrets parts with no separator', async () => {
    const parts: readonly RefToken[] = [
      'config.secrets.wrapPrefix',
      'carry.modulus',
      'config.secrets.wrapSuffix',
    ];
    const result = await runDerive([{ into: 'wrapped', parts }]);
    const wrapped = 'syn-pre-syn-mod-syn-post';
    expect(result).toMatchObject({
      success: true,
      value: { carry: { wrapped, ...PRESERVED } },
    });
  });

  it('UT-DV-03 fails the step with the evaluator message when a part is missing', async () => {
    const parts: readonly RefToken[] = ['carry.xsrfToken', 'carry.absent'];
    const result = await runDerive([{ into: 'composite', parts, separator: '###3' }]);
    const errorMessage = 'derivedCarry: carry.absent missing or non-string';
    expect(result).toMatchObject({ success: false, errorMessage });
  });

  it('UT-DV-04 digests a body extract with the md5-hex op', async () => {
    const op = { kind: 'md5-hex' } as const;
    const result = await runDerive([{ into: 'digest', parts: ['carry.xsrfToken'], op }]);
    const digest = '40cff534dd1826c2274da23e9dc3d8d8';
    expect(result).toMatchObject({ success: true, value: { carry: { digest } } });
  });

  it('UT-DV-05 fails the step naming the slot when no format rule matches', async () => {
    const rules = [{ pattern: String.raw`\d+`, prefix: '0' }];
    const op = { kind: 'format', rules } as const;
    const result = await runDerive([{ into: 'uid', parts: ['carry.modulus'], op }]);
    const errorMessage = 'bind derive uid unformattable';
    expect(result).toMatchObject({ success: false, errorMessage });
  });

  it('carries the one decoded query value without changing other slots', async () => {
    const result = await runQuery('https://route.example/?tracking=route%2B%26+%D7%90');
    expect(result).toMatchObject({
      success: true,
      value: { carry: { tracking: 'route+& א', ...PRESERVED } },
    });
  });

  it('preserves the default behavior for a whitespace-only query value', async () => {
    const result = await runQuery('https://route.example/?tracking=%20%20');
    expect(result).toMatchObject({ success: true, value: { carry: { tracking: '  ' } } });
  });

  it('preserves well-formed Unicode surrogate pairs in query values', async () => {
    const tracking = 'route\ud83d\ude00';
    const result = await runQuery(`https://route.example/?tracking=${tracking}`);
    expect(result).toMatchObject({ success: true, value: { carry: { tracking } } });
  });

  it('rejects a whitespace-only query only when explicitly configured', async () => {
    const op = { kind: 'url-query', key: 'tracking', rejectBlank: true } as const;
    const derive = { into: 'tracking', parts: ['carry.entry'] as const, op };
    const blank = await runDerive([derive], { entry: 'https://route.example/?tracking=%20%20' });
    const text = await runDerive([derive], { entry: 'https://route.example/?tracking=%20a%20' });
    expect(blank).toMatchObject({
      success: false,
      errorMessage: 'bind derive tracking unformattable',
    });
    expect(text).toMatchObject({ success: true, value: { carry: { tracking: ' a ' } } });
  });

  it('accepts a query value at the maximum length', async () => {
    const tracking = 'x'.repeat(8192);
    const result = await runQuery(`https://route.example/?tracking=${tracking}`);
    expect(result).toMatchObject({ success: true, value: { carry: { tracking } } });
  });

  it.each([
    ['invalid URL', 'not an absolute URL'],
    ['missing key', 'https://route.example/?other=value'],
    ['empty value', 'https://route.example/?tracking='],
    ['duplicate key', 'https://route.example/?tracking=first&tracking=second'],
    ['encoded duplicate key', 'https://route.example/?tracking=first&%74racking=second'],
    ['encoded control', 'https://route.example/?tracking=bad%00value'],
    ['encoded C1 control', 'https://route.example/?tracking=bad%C2%85value'],
    ['raw control', 'https://route.example/?tracking=bad\nvalue'],
    ['unpaired high surrogate', 'https://route.example/?tracking=route\ud800'],
    ['unpaired low surrogate', 'https://route.example/?tracking=route\udc00'],
    ['malformed Unicode elsewhere in URL', 'https://route.example/\ud800?tracking=route'],
    ['malformed escape', 'https://route.example/?tracking=%C0%AF'],
    ['oversized value', `https://route.example/?tracking=${'x'.repeat(8193)}`],
    ['oversized URL', `https://route.example/?tracking=ok&other=${'x'.repeat(32768)}`],
  ])('refuses %s without naming the value', async (_label, url) => {
    const result = await runQuery(url);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'bind derive tracking unformattable',
    });
  });
});
