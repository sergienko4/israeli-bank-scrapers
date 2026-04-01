/**
 * Unit tests for LoginSteps credential validation.
 * Verifies fail-fast on missing or empty credentials.
 */

import type { ScraperCredentials } from '../../../../../Scrapers/Base/Interface.js';
import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { createLoginPhase } from '../../../../../Scrapers/Pipeline/Phases/Login/LoginSteps.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { makeContextWithLogin, makeMockMediator } from '../MockPipelineFactories.js';

/**
 * Create a minimal ILoginConfig stub.
 * @param overrides - Optional field overrides.
 * @returns Minimal ILoginConfig.
 */
const MAKE_CONFIG = (overrides: Partial<ILoginConfig> = {}): ILoginConfig =>
  ({
    loginUrl: 'https://bank.test/login',
    fields: [],
    submit: [{ kind: 'textContent', value: 'כניסה' }],
    possibleResults: {},
    ...overrides,
  }) as unknown as ILoginConfig;

describe('LoginSteps/credential-validation', () => {
  it('fails fast when a required credential key is absent', async () => {
    const ctx = makeContextWithLogin();
    const mediator = makeMockMediator();
    const mediatorSome = some(mediator);
    const withMediator = { ...ctx, mediator: mediatorSome };
    const config = MAKE_CONFIG({
      fields: [
        { credentialKey: 'username', selectors: [] },
        { credentialKey: 'missingKey', selectors: [] },
      ],
    });
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(withMediator, withMediator);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('Missing credentials: missingKey');
  });

  it('fails fast when credential value is empty string', async () => {
    const ctx = makeContextWithLogin();
    const creds = { username: '', password: 'testpass' } as unknown as ScraperCredentials;
    const withCreds = { ...ctx, credentials: creds };
    const mediator = makeMockMediator();
    const mediatorSome = some(mediator);
    const withMediator = { ...withCreds, mediator: mediatorSome };
    const config = MAKE_CONFIG({
      fields: [{ credentialKey: 'username', selectors: [] }],
    });
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(withMediator, withMediator);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('Missing credentials: username');
  });

  it('lists ALL missing keys in one message', async () => {
    const ctx = makeContextWithLogin();
    const mediator = makeMockMediator();
    const mediatorSome = some(mediator);
    const withMediator = { ...ctx, mediator: mediatorSome };
    const config = MAKE_CONFIG({
      fields: [
        { credentialKey: 'idNumber', selectors: [] },
        { credentialKey: 'pin', selectors: [] },
      ],
    });
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(withMediator, withMediator);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('idNumber');
      expect(result.errorMessage).toContain('pin');
    }
  });
});
