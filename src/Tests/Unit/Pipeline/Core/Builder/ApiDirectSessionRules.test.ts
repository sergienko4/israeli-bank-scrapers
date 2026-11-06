/**
 * A flow's `sessionCarry` allowlist is checked when the pipeline is
 * built: every slot must name a body or header extract, or the checked
 * final URL, of some step, so a generated key or a typo never reaches the
 * scrape's session context.
 * `cookieHandoff: 'isolate'` needs a domain jar to empty.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  CookieHandoff,
  IGetStep,
  IStepConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const SLOT_MSG = 'sessionCarry: each slot must name a step extract';
const HANDOFF_MSG = 'cookieHandoff: isolate not allowed without headless.cookieDomains';

/** The bank's headless block, as the rules read it. */
type Headless = IApiDirectRuleInput['headless'];

const NATIVE = {
  identityBase: 'https://bank.example',
  graphql: 'https://bank.example/graphql',
  paths: {},
  nativeFetch: true,
};

/** The native block with a domain jar. */
const JARRED: Headless = {
  ...NATIVE,
  sessionCookies: true,
  cookieDomains: ['bank.example'],
};

const REGISTER: IStepConfig = {
  name: 'register',
  urlTag: 'auth.bind',
  generate: [{ kind: 'rsa-key', bits: 2048, keyInto: 'certKeyPem' }],
  body: { shape: {} },
  extractsToCarry: { token: '/access_token' },
  headerExtractsToCarry: { mag: { header: 'mag-identifier' } },
};

/** The native block refusing redirects, as a manual redirect needs. */
const REJECTING: Headless = { ...NATIVE, redirectPolicy: 'reject' };

/** A GET whose final URL, checked by its manual redirect, lands in the carry. */
const LANDING: IGetStep = {
  name: 'landing',
  urlTag: 'auth.landing',
  method: 'GET',
  extractsToCarry: {},
  redirect: { maxHops: 3, allow: [{ origin: 'https://bank.example', paths: ['/landing'] }] },
  finalUrlInto: 'landingUrl',
};

/**
 * Validate a two-step flow with the given allowlist.
 * @param sessionCarry - Allowlist under test.
 * @returns Build-rule verdict.
 */
function validateWith(sessionCarry: readonly string[]): ReturnType<typeof validateApiDirectConfig> {
  const steps = [REGISTER, LANDING];
  const call = { flow: 'sms-otp', envelope: {}, steps, sessionCarry } as const;
  return validateApiDirectConfig({ call, headless: REJECTING });
}

describe('validateApiDirectConfig — sessionCarry', () => {
  it.each<[string, readonly string[]]>([
    ['a header extract', ['mag']],
    ['a body extract', ['token']],
    ['a checked final URL', ['landingUrl']],
    ['no slot', []],
  ])('an allowlist naming %s passes', (_label, sessionCarry) => {
    const result = validateWith(sessionCarry);
    expect(result).toEqual({ success: true, value: true });
  });

  it.each<[string, readonly string[]]>([
    ['a slot no step extracts', ['mag', 'csrf']],
    ['a generated key', ['certKeyPem']],
  ])('an allowlist naming %s fails the build', (_label, sessionCarry) => {
    const result = validateWith(sessionCarry);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: SLOT_MSG,
    });
  });
});

/**
 * Validate a one-step flow with the given headless block and hand-off.
 * @param headless - Headless block.
 * @param cookieHandoff - Hand-off under test; omitted for the default.
 * @returns Build-rule verdict.
 */
function validateHandoff(
  headless: Headless,
  cookieHandoff?: CookieHandoff,
): ReturnType<typeof validateApiDirectConfig> {
  const call = { flow: 'sms-otp', envelope: {}, steps: [REGISTER], cookieHandoff } as const;
  return validateApiDirectConfig({ call, headless });
}

describe('validateApiDirectConfig — cookieHandoff', () => {
  it.each<[string, Headless, CookieHandoff | undefined]>([
    ['isolate with a domain jar', JARRED, 'isolate'],
    ['shared without one', NATIVE, 'shared'],
    ['the default without one', NATIVE, undefined],
  ])('%s passes', (_label, headless, cookieHandoff) => {
    const result = validateHandoff(headless, cookieHandoff);
    expect(result).toEqual({ success: true, value: true });
  });

  it('isolate without a domain jar fails the build', () => {
    const result = validateHandoff(NATIVE, 'isolate');
    expect(result).toMatchObject({ success: false, errorMessage: HANDOFF_MSG });
  });
});
