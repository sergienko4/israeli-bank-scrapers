/**
 * Required credentials are checked before the first step.
 *
 * A missing or malformed field fails the flow by name, with no request sent
 * and no value in the message; sound credentials let the first step fire.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  CredRule,
  IApiDirectCallConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runSmsOtpFlow } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/SmsOtpFlow.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { type IApiPostCapture, makeStubMediator } from './StubMediator.js';

const HINT = CompanyTypes.OneZero;

/** One rule, a value, and whether the rule accepts it. */
interface IRuleCase {
  readonly rule: CredRule;
  readonly value: unknown;
  readonly isAccepted: boolean;
}

const RULE_CASES: readonly IRuleCase[] = [
  { rule: 'nonEmpty', value: 'syn-pass', isAccepted: true },
  { rule: 'nonEmpty', value: '   ', isAccepted: false },
  { rule: 'nonEmpty', value: undefined, isAccepted: false },
  { rule: 'digits', value: '012345678', isAccepted: true },
  { rule: 'digits', value: '01234a678', isAccepted: false },
  { rule: 'digits', value: 12345, isAccepted: false },
  { rule: 'sixDigits', value: '123456', isAccepted: true },
  { rule: 'sixDigits', value: '12345', isAccepted: false },
  { rule: 'sixDigits', value: '1234567', isAccepted: false },
  { rule: 'latin1', value: 'syn-p\u00e4ss\u00ff', isAccepted: true },
  { rule: 'latin1', value: 'syn-pass\u0100', isAccepted: false },
  { rule: 'latin1', value: 'syn-\u05d0', isAccepted: false },
  { rule: 'latin1', value: 'syn-\u{1f600}', isAccepted: false },
  { rule: 'latin1', value: '   ', isAccepted: false },
  { rule: 'latin1', value: undefined, isAccepted: false },
];

/**
 * One-step config that requires a single field under the given rule.
 * @param requiredCreds - Field → rule map.
 * @returns API-direct-call config literal.
 */
function makeConfig(requiredCreds: Readonly<Record<string, CredRule>>): IApiDirectCallConfig {
  return {
    flow: 'sms-otp',
    envelope: {},
    probe: { queryTag: 'customer' },
    requiredCreds,
    steps: [
      {
        name: 'bind',
        urlTag: 'auth.bind',
        body: { shape: { x: { $literal: 1 } } },
        extractsToCarry: { token: '/data/accessToken' },
      },
    ],
  };
}

/**
 * Run the flow once and report what it sent.
 * @param config - Config literal.
 * @param creds - Caller credentials.
 * @returns The flow result and every request it sent.
 */
async function runOnce(
  config: IApiDirectCallConfig,
  creds: Readonly<Record<string, unknown>>,
): Promise<{ result: Awaited<ReturnType<typeof runSmsOtpFlow>>; captures: IApiPostCapture[] }> {
  const captures: IApiPostCapture[] = [];
  const responses = [succeed({ data: { accessToken: 'syn-token' } })];
  const bus = makeStubMediator({ responses, captures });
  const result = await runSmsOtpFlow({ config, bus, creds, companyId: HINT });
  return { result, captures };
}

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, 'https://example.test/api/bind');
});

describe('required credentials', () => {
  it.each(RULE_CASES)('$rule on $value → accepted=$isAccepted', async (row): Promise<void> => {
    const config = makeConfig({ field: row.rule });
    const { result, captures } = await runOnce(config, { field: row.value });
    expect(result.success).toBe(row.isAccepted);
    const sentCount = Number(row.isAccepted);
    expect(captures).toHaveLength(sentCount);
  });

  it('names every bad field and never a value', async (): Promise<void> => {
    const config = makeConfig({ id: 'digits', password: 'nonEmpty', card6Digits: 'sixDigits' });
    const creds = { id: 'syn-id-x', password: 'syn-secret', card6Digits: '12' };
    const { result, captures } = await runOnce(config, creds);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'Missing or malformed credentials: id, card6Digits',
    });
    expect(captures).toHaveLength(0);
  });
});
