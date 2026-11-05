/**
 * N28 — a carry-bundle warm start is checked when the pipeline is built.
 *
 * The bundle binds to at least one creds field, keeps at least one slot a
 * login step fills (an extract or a generator output), and keeps the jar only
 * beside a cookie-domain session. The provider and ceiling rules the cookie
 * jar already has apply to the bundle too.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  ICarryBundleWarmStart,
  IStepConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

/** The bank's headless block as the rules read it. */
type HeadlessBlock = IApiDirectRuleInput['headless'];

/** A headless block with a cookie-domain session, as a jar-keeping bundle needs. */
const DOMAINS = {
  sessionCookies: true,
  nativeFetch: true,
  cookieDomains: ['bank.example'],
} as unknown as HeadlessBlock;

/** A session without cookie domains. */
const SESSION_ONLY = { sessionCookies: true } as unknown as HeadlessBlock;

/** The step that fills the kept slots: one extract, two generator outputs. */
const REGISTER: IStepConfig = {
  name: 'register',
  urlTag: 'auth.bind',
  body: { shape: {} },
  extractsToCarry: { clientId: '/data/clientId' },
  generate: [{ kind: 'rsa-key', bits: 2048, keyInto: 'keyPem', spkiSha256HexInto: 'spkiHex' }],
};

/** The resumed token step. */
const LOGON: IStepConfig = {
  name: 'login',
  urlTag: 'auth.assert',
  body: { shape: { cid: { $ref: 'carry.clientId' } } },
  extractsToCarry: { token: '/data/accessToken' },
};

/** A step generating a request into the `csrPem` slot. */
const CSR_STEP: IStepConfig = {
  ...REGISTER,
  generate: [
    {
      kind: 'pkcs10-csr',
      keyRef: 'carry.keyPem',
      subject: [{ attr: 'CN', value: { $literal: 'syn' } }],
      into: 'csrPem',
    },
  ],
};

/** The bundle fields a test may replace. */
type BundleFields = Partial<
  Pick<ICarryBundleWarmStart, 'provider' | 'accountFields' | 'slots' | 'maxTokenChars' | 'cookies'>
>;

/** What a rule input varies. */
interface IBundleCase {
  readonly fields?: BundleFields;
  readonly headless?: HeadlessBlock;
  readonly steps?: readonly IStepConfig[];
}

/**
 * A two-step config warm-started from a carry bundle.
 * @param bundleCase - Bundle fields, headless block and steps to set.
 * @returns Rule input, sound unless the case breaks it.
 */
function bundleWarm(bundleCase: IBundleCase = {}): IApiDirectRuleInput {
  const warmStart = {
    kind: 'carry-bundle',
    credsField: 'otpLongTermToken',
    fromStepIndex: 1,
    validation: 'bank-call',
    provider: 'syn-bank',
    accountFields: ['num', 'nationalID'],
    slots: ['clientId', 'keyPem'],
    maxTokenChars: 16384,
    cookies: true,
    coldFallback: 'auth-rejected',
    ...bundleCase.fields,
  } as const;
  const steps = bundleCase.steps ?? [REGISTER, LOGON];
  const call: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps, warmStart };
  return { call, headless: bundleCase.headless ?? DOMAINS };
}

/** A rule input and the failure text it must produce. */
type BrokenCase = readonly [string, IApiDirectRuleInput, string];

const ACCOUNTS_MSG = 'warmStart.accountFields: must name a creds field, none blank';
const SLOTS_EMPTY_MSG = 'warmStart.slots: must not be empty';
const SLOTS_FILLED_MSG = 'warmStart.slots: each slot must be filled by a login step';
const COOKIES_MSG = 'warmStart.cookies: not allowed without headless.cookieDomains';
const PROVIDER_MSG = 'warmStart.provider: must not be blank';
const MAX_TOKEN_MSG = 'warmStart.maxTokenChars: must be an integer from 1 to 16384';

const BROKEN: readonly BrokenCase[] = [
  ['no account fields', bundleWarm({ fields: { accountFields: [] } }), ACCOUNTS_MSG],
  ['a blank account field', bundleWarm({ fields: { accountFields: ['num', ' '] } }), ACCOUNTS_MSG],
  ['no slots', bundleWarm({ fields: { slots: [] } }), SLOTS_EMPTY_MSG],
  [
    'a slot no step fills',
    bundleWarm({ fields: { slots: ['clientId', 'otp'] } }),
    SLOTS_FILLED_MSG,
  ],
  ['the jar without a headless block', bundleWarm({ headless: false }), COOKIES_MSG],
  ['the jar without cookie domains', bundleWarm({ headless: SESSION_ONLY }), COOKIES_MSG],
  ['a blank provider', bundleWarm({ fields: { provider: ' ' } }), PROVIDER_MSG],
  ['a zero ceiling', bundleWarm({ fields: { maxTokenChars: 0 } }), MAX_TOKEN_MSG],
  [
    'a ceiling over the seed limit',
    bundleWarm({ fields: { maxTokenChars: 16385 } }),
    MAX_TOKEN_MSG,
  ],
];

/** A config the rules accept. */
type SoundCase = readonly [string, IApiDirectRuleInput];

const SOUND: readonly SoundCase[] = [
  ['an extract and a generated key', bundleWarm()],
  ['an rsa-key fingerprint slot', bundleWarm({ fields: { slots: ['spkiHex'] } })],
  [
    'a pkcs10-csr output slot',
    bundleWarm({ fields: { slots: ['csrPem'] }, steps: [CSR_STEP, LOGON] }),
  ],
  ['no jar and no headless block', bundleWarm({ fields: { cookies: false }, headless: false })],
  ['the lowest ceiling', bundleWarm({ fields: { maxTokenChars: 1 } })],
];

describe('carry-bundle warm config rules', () => {
  it.each(BROKEN)('%s → fails with the rule text', (_label, input, message) => {
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: message,
    });
  });

  it.each(SOUND)('%s → passes', (_label, input) => {
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
