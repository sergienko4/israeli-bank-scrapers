/**
 * Max API-direct call config — the invariants the login flow relies on.
 *
 * The config is data only, so these checks pin what a run cannot survive
 * losing: the build-time validator accepts it with its headless block, the
 * session is primed before the password is sent, the login body hydrates to
 * the field set a live login proved, each `LoginStatus` maps to its typed
 * error, and every call carries the session id and a fresh correlation id.
 *
 * Uses dynamic imports for `Registry/Config/*` per the project's test rule
 * (Pipeline tests don't statically import from Registry/Config).
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { hydrate } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';

const CONFIG_DIR = '../../../../../Scrapers/Pipeline/Registry/Config/';

/** The bank's headless block, as the build-time validator reads it. */
type IHeadlessUrlsConfig = Exclude<IApiDirectRuleInput['headless'], false>;

/** Max's login config and headless block. */
interface IMaxModule {
  readonly call: IApiDirectCallConfig;
  readonly headless: IHeadlessUrlsConfig;
}

const ORIGIN = 'https://www.max.co.il';
const CREDS = { username: 'user1', password: 'pw' } as const;

/**
 * Load Max's config module.
 * @returns Its login config and headless block.
 */
async function loadMax(): Promise<IMaxModule> {
  const path = `${CONFIG_DIR}PipelineBankConfigMax.js`;
  const loaded = (await import(path)) as Record<string, unknown>;
  const call = loaded.default as IApiDirectCallConfig;
  const headless = loaded.MAX_HEADLESS as IHeadlessUrlsConfig;
  return { call, headless };
}

describe('Max API-direct call config', () => {
  it('passes the build-time validator with its headless block', async () => {
    const { call, headless } = await loadMax();
    const result = validateApiDirectConfig({ call, headless });
    expect(result).toEqual({ success: true, value: true });
  });

  it('primes the session with a GET, then logs in with the password', async () => {
    const { call } = await loadMax();
    const route = call.steps.map(step => [step.name, step.urlTag, step.method ?? 'POST']);
    expect(route).toEqual([
      ['prime', 'auth.prime', 'GET'],
      ['login', 'auth.login', 'POST'],
    ]);
    expect(call.steps[0]).not.toHaveProperty('body');
    expect(call.steps[0]).not.toHaveProperty('outcome');
  });

  it('sends the username and password with a null id', async () => {
    const { call } = await loadMax();
    const login = call.steps[1];
    const scope = { carry: {}, creds: CREDS, config: call };
    const body = hydrate(login.body?.shape ?? {}, scope);
    expect(body).toEqual({ success: true, value: { ...CREDS, id: null } });
  });

  it('maps each LoginStatus to its typed error', async () => {
    const { call } = await loadMax();
    expect(call.steps[1].outcome).toEqual({
      codePointer: '/Result/LoginStatus',
      successCodes: ['0'],
      failureMap: {
        '1': ScraperErrorTypes.ChangePassword,
        '4': ScraperErrorTypes.InvalidPassword,
      },
      defaultFailure: ScraperErrorTypes.Generic,
    });
  });

  it('stores no warm token, so every run logs in cold', async () => {
    const { call } = await loadMax();
    expect(call).not.toHaveProperty('warmStart');
  });

  it('sends lowercase headers, plus the session id and a fresh call id', async () => {
    const { call } = await loadMax();
    const names = Object.keys(call.staticHeaders ?? {});
    const lowered = names.map(name => name.toLowerCase());
    expect(names).toEqual(lowered);
    expect(call.staticHeaders).toMatchObject({ origin: ORIGIN, urf: '', cav: '' });
    const perCall = { sid: { $ref: 'carry.flowId' }, cid: { $ref: 'uuid' } };
    for (const step of call.steps) expect(step.headers).toEqual(perCall);
  });

  it('requires a non-empty username and password before any call', async () => {
    const { call } = await loadMax();
    expect(call.requiredCreds).toEqual({ username: 'nonEmpty', password: 'nonEmpty' });
  });

  it('runs over native fetch, with the session on cookies rather than a header', async () => {
    const { call, headless } = await loadMax();
    expect(call.authScheme).toBe('none');
    expect(headless).toMatchObject({ nativeFetch: true, sessionCookies: true });
    expect(headless.paths).toEqual({
      'auth.prime': `${ORIGIN}/api/registered/clientcontext`,
      'auth.login': `${ORIGIN}/api/login/login`,
    });
  });

  it('is registered as an api-direct card issuer on that headless block', async () => {
    const { headless } = await loadMax();
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const entry = resolvePipelineBankConfig(CompanyTypes.Max);
    expect(entry).toMatchObject({ authStrategyKind: 'api-direct', balanceKind: 'card-cycle' });
    const isWired = entry !== false && entry.headless === headless;
    expect(isWired).toBe(true);
  });
});
