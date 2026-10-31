/**
 * N32 — a flow's `sessionCarry` allowlist is checked when the pipeline is
 * built: every slot must name a body or header extract of some step, so a
 * generated key or a typo never reaches the scrape's session context.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { validateApiDirectConfig } from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type { IStepConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const SLOT_MSG = 'sessionCarry: each slot must name a step extract';

const NATIVE = {
  identityBase: 'https://bank.example',
  graphql: 'https://bank.example/graphql',
  paths: {},
  nativeFetch: true,
};

const REGISTER: IStepConfig = {
  name: 'register',
  urlTag: 'auth.bind',
  generate: [{ kind: 'rsa-key', bits: 2048, keyInto: 'certKeyPem' }],
  body: { shape: {} },
  extractsToCarry: { token: '/access_token' },
  headerExtractsToCarry: { mag: { header: 'mag-identifier' } },
};

/**
 * Validate a one-step flow with the given allowlist.
 * @param sessionCarry - Allowlist under test.
 * @returns Build-rule verdict.
 */
function validateWith(sessionCarry: readonly string[]): ReturnType<typeof validateApiDirectConfig> {
  const call = { flow: 'sms-otp', envelope: {}, steps: [REGISTER], sessionCarry } as const;
  return validateApiDirectConfig({ call, headless: NATIVE });
}

describe('validateApiDirectConfig — sessionCarry', () => {
  it.each<[string, readonly string[]]>([
    ['a header extract', ['mag']],
    ['a body extract', ['token']],
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
