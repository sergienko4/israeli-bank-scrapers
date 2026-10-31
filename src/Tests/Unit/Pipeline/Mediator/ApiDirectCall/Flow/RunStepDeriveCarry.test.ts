/**
 * N7 — a step may derive carry slots after its extracts. `deriveCarry` runs
 * the flow-init derivation evaluator over the step's merged scope: body and
 * header extracts of this step, earlier carry, creds and `config.secrets`.
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
 * @returns The step's result.
 */
function runDerive(deriveCarry: IGetStep['deriveCarry']): ReturnType<typeof runStep> {
  installJsonAnswer(ANSWER_BODY, ANSWER_HEADERS);
  const step: IGetStep = { ...BASE_STEP, deriveCarry };
  const bus = makeNativeMediator(HINT, ORIGIN);
  return runStep({ step, bus, scope: makeScope(), companyId: HINT });
}

describe('N7 step-level derived carry', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('UT-DV-01 joins a body extract and a header extract with a separator', async () => {
    const parts: readonly RefToken[] = ['carry.xsrfToken', 'carry.serid'];
    const result = await runDerive([{ into: 'composite', parts, separator: '###3' }]);
    const composite = 'syn-xsrf###3syn-serid';
    expect(result).toMatchObject({ success: true, value: { carry: { composite } } });
  });

  it('UT-DV-02 wraps an extract in config.secrets parts with no separator', async () => {
    const parts: readonly RefToken[] = [
      'config.secrets.wrapPrefix',
      'carry.modulus',
      'config.secrets.wrapSuffix',
    ];
    const result = await runDerive([{ into: 'wrapped', parts }]);
    const wrapped = 'syn-pre-syn-mod-syn-post';
    expect(result).toMatchObject({ success: true, value: { carry: { wrapped } } });
  });

  it('UT-DV-03 fails the step with the evaluator message when a part is missing', async () => {
    const parts: readonly RefToken[] = ['carry.xsrfToken', 'carry.absent'];
    const result = await runDerive([{ into: 'composite', parts, separator: '###3' }]);
    const errorMessage = 'derivedCarry: carry.absent missing or non-string';
    expect(result).toMatchObject({ success: false, errorMessage });
  });
});
