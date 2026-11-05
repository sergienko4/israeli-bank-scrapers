/**
 * E10 — optional extracts.
 *
 * A slot the response may omit is written when its pointer resolves to a
 * string that is not blank, falls back when a fallback is set, and otherwise keeps
 * the value an earlier step stored.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const HINT = CompanyTypes.OneZero;

const CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

const STEP: IStepConfig = {
  name: 'validate',
  urlTag: 'auth.bind',
  body: { shape: {} },
  extractsToCarry: { code: '/bean/returnCode' },
  optionalExtractsToCarry: {
    bcKey: { pointer: '/bean/bcKey' },
    userName: { pointer: '/bean/userName', fallback: '' },
  },
};

/** One response and the carry the step must end with. */
interface IOptionalCase {
  readonly label: string;
  readonly bean: Readonly<Record<string, unknown>>;
  readonly expected: Readonly<Record<string, string>>;
}

const CASES: readonly IOptionalCase[] = [
  {
    label: 'writes present values over earlier ones',
    bean: { returnCode: '1', bcKey: 'syn-bc-2', userName: 'syn-user' },
    expected: { code: '1', bcKey: 'syn-bc-2', userName: 'syn-user' },
  },
  {
    label: 'writes the fallback and keeps a slot without one when absent',
    bean: { returnCode: '1' },
    expected: { code: '1', bcKey: 'syn-bc-1', userName: '' },
  },
  {
    label: 'treats a blank or non-string field as absent',
    bean: { returnCode: '1', bcKey: '', userName: 7 },
    expected: { code: '1', bcKey: 'syn-bc-1', userName: '' },
  },
  {
    label: 'treats a whitespace-only field as absent',
    bean: { returnCode: '1', bcKey: '   ', userName: '\t' },
    expected: { code: '1', bcKey: 'syn-bc-1', userName: '' },
  },
  {
    label: 'writes a padded value as it is',
    bean: { returnCode: '1', bcKey: ' syn-bc-3 ' },
    expected: { code: '1', bcKey: ' syn-bc-3 ', userName: '' },
  },
];

/** A step whose `bcKey` slot keeps the value carry already holds (N56). */
const KEEP_STEP: IStepConfig = {
  ...STEP,
  optionalExtractsToCarry: { bcKey: { pointer: '/bean/bcKey', keepExisting: true } },
};

const KEEP_STEPS: readonly { readonly label: string; readonly step: IStepConfig }[] = [
  { label: 'against a different answer', step: KEEP_STEP },
  {
    label: 'when the slot is ruled',
    step: { ...KEEP_STEP, extractRules: { bcKey: { type: 'string' } } },
  },
];

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, 'https://example.test/api/validate');
});

describe('E10 optional extracts', () => {
  it.each(CASES)('$label', async (row): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ bean: row.bean })];
    const bus = makeStubMediator({ responses, captures });
    const carry = { bcKey: 'syn-bc-1' };
    const scope: ITemplateScope = { carry, creds: {}, config: CONFIG, keypair: undefined };
    const result = await runStep({ step: STEP, bus, scope, companyId: HINT });
    expect(result).toMatchObject({ success: true, value: { carry: row.expected } });
  });

  it.each(KEEP_STEPS)(
    'keeps a held keep-existing slot $label (N56)',
    async (row): Promise<void> => {
      const responses = [succeed({ bean: { returnCode: '1', bcKey: 'syn-bc-2' } })];
      const bus = makeStubMediator({ responses, captures: [] });
      const carry = { bcKey: 'syn-bc-1' };
      const scope: ITemplateScope = { carry, creds: {}, config: CONFIG, keypair: undefined };
      const result = await runStep({ step: row.step, bus, scope, companyId: HINT });
      expect(result).toMatchObject({ success: true, value: { carry: { bcKey: 'syn-bc-1' } } });
    },
  );

  it.each([
    ['no earlier value', {}],
    ['an empty earlier value', { bcKey: '' }],
  ])('rejects a numeric keep-existing slot with %s', async (_label, carry) => {
    const responses = [succeed({ bean: { returnCode: '1', bcKey: 42 } })];
    const bus = makeStubMediator({ responses, captures: [] });
    const scope: ITemplateScope = { carry, creds: {}, config: CONFIG, keypair: undefined };
    const step: IStepConfig = { ...KEEP_STEP, extractRules: { bcKey: { type: 'string' } } };
    const result = await runStep({ step, bus, scope, companyId: HINT });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'validate extract bcKey invalid',
    });
  });

  it('ignores a numeric answer when a keep-existing slot already holds text', async () => {
    const responses = [succeed({ bean: { returnCode: '1', bcKey: 42 } })];
    const bus = makeStubMediator({ responses, captures: [] });
    const scope: ITemplateScope = {
      carry: { bcKey: 'syn-bc-1' },
      creds: {},
      config: CONFIG,
      keypair: undefined,
    };
    const step: IStepConfig = { ...KEEP_STEP, extractRules: { bcKey: { type: 'string' } } };
    const result = await runStep({ step, bus, scope, companyId: HINT });
    expect(result).toMatchObject({
      success: true,
      value: { carry: { bcKey: 'syn-bc-1' } },
    });
  });

  it('still fails when a required extract is missing', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const responses = [succeed({ bean: { bcKey: 'syn-bc-2' } })];
    const bus = makeStubMediator({ responses, captures });
    const scope: ITemplateScope = { carry: {}, creds: {}, config: CONFIG, keypair: undefined };
    const result = await runStep({ step: STEP, bus, scope, companyId: HINT });
    expect(result).toMatchObject({ success: false });
  });

  it('checks a fallback before writing a ruled optional URL', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [succeed({ bean: { returnCode: '1' } })], captures });
    const scope: ITemplateScope = { carry: {}, creds: {}, config: CONFIG, keypair: undefined };
    const step: IStepConfig = {
      ...STEP,
      optionalExtractsToCarry: {
        handoffUrl: { pointer: '/bean/handoff', fallback: 'https://outside.test/collect' },
      },
      extractRules: {
        handoffUrl: { url: [{ origin: 'https://example.test', paths: ['/portal/landing'] }] },
      },
    };
    const result = await runStep({ step, bus, scope, companyId: HINT });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'validate extract handoffUrl invalid',
    });
  });
});
