/**
 * VisaCal API-direct call config — the invariants the login flow relies on.
 *
 * The config is data only, so these checks pin what a run cannot survive
 * losing: the build-time validator accepts it with its headless block, the
 * warm entry step reads the very carry slot the stored token seeds, the bank's
 * wrong-credentials code maps to `InvalidPassword` on both steps, and no login
 * header name could sit beside the transport's lowercase default.
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
import { warmCarryField } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/WarmStartKind.js';

const CONFIG_DIR = '../../../../../Scrapers/Pipeline/Registry/Config/';

/** The bank's headless block, as the build-time validator reads it. */
type IHeadlessUrlsConfig = Exclude<IApiDirectRuleInput['headless'], false>;

/** Module shape shared by the call-config and headless-block modules. */
interface IDefaultModule<T> {
  readonly default: T;
}

/**
 * Load the VisaCal call config.
 * @returns The call config.
 */
async function loadCall(): Promise<IApiDirectCallConfig> {
  const path = `${CONFIG_DIR}PipelineBankConfigVisaCal.js`;
  const mod = (await import(path)) as IDefaultModule<IApiDirectCallConfig>;
  return mod.default;
}

/**
 * Load the VisaCal headless block.
 * @returns The headless block.
 */
async function loadHeadless(): Promise<IHeadlessUrlsConfig> {
  const path = `${CONFIG_DIR}PipelineBankConfigVisaCalHeadless.js`;
  const mod = (await import(path)) as IDefaultModule<IHeadlessUrlsConfig>;
  return mod.default;
}

describe('VisaCal API-direct call config', () => {
  it('passes the build-time validator with its headless block', async () => {
    const call = await loadCall();
    const headless = await loadHeadless();
    const result = validateApiDirectConfig({ call, headless });
    expect(result).toEqual({ success: true, value: true });
  });

  it('logs in with the password, then trades the hash for a token', async () => {
    const call = await loadCall();
    const names = call.steps.map(step => step.name);
    expect(names).toEqual(['login', 'resume']);
    expect(call.authScheme).toBe('prefixed');
    expect(call.authPrefix).toBe('CALAuthScheme ');
  });

  it('starts the warm path at the step that reads the stored hash', async () => {
    const call = await loadCall();
    const warm = call.warmStart;
    const entry = call.steps[warm?.fromStepIndex ?? -1];
    const carryField = warmCarryField(call);
    expect(warm?.validation).toBe('bank-call');
    expect(entry.body?.shape).toEqual({ hash: { $ref: `carry.${carryField}` } });
    expect(entry.extractsToCarry[carryField]).toBe('/result/hash');
  });

  it('maps the wrong-credentials code to InvalidPassword on both steps', async () => {
    const call = await loadCall();
    for (const step of call.steps) {
      expect(step.outcome?.successCodes).toEqual(['1']);
      expect(step.outcome?.failureMap['4']).toBe(ScraperErrorTypes.InvalidPassword);
      expect(step.outcome?.defaultFailure).toBe(ScraperErrorTypes.Generic);
    }
  });

  it('names its login headers in lowercase', async () => {
    const call = await loadCall();
    const names = Object.keys(call.staticHeaders ?? {});
    const lowered = names.map(name => name.toLowerCase());
    expect(names).toEqual(lowered);
    expect(names).toContain('x-site-id');
  });

  it('requires a non-empty username and password before any call', async () => {
    const call = await loadCall();
    expect(call.requiredCreds).toEqual({ username: 'nonEmpty', password: 'nonEmpty' });
  });

  it('runs over native fetch with both login paths seeded', async () => {
    const headless = await loadHeadless();
    expect(headless.nativeFetch).toBe(true);
    const paths = Object.keys(headless.paths);
    const sorted = paths.sort();
    expect(sorted).toEqual(['auth.login', 'auth.resume']);
  });

  it('is registered on that headless block', async () => {
    const headless = await loadHeadless();
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const entry = resolvePipelineBankConfig(CompanyTypes.VisaCal);
    const isWired = entry !== false && entry.headless === headless;
    expect(isWired).toBe(true);
  });
});
