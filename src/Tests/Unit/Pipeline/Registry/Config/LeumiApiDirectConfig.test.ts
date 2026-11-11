/**
 * The complete Leumi configuration drives the registered native pipeline.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import PIPELINE_REGISTRY from '../../../../../Scrapers/Pipeline/Banks/PipelineRegistry.js';
import { validateApiDirectConfig } from '../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { buildCollectionResult } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Fingerprint/GenericFingerprintBuilder.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';

const MODULE = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigLeumi.js';
const REGISTRY = '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js';
type IHeadless = Exclude<Parameters<typeof validateApiDirectConfig>[0]['transport'], false>;

interface ILeumiModule {
  readonly LEUMI_API_DIRECT_CALL: IApiDirectCallConfig;
  readonly LEUMI_TRANSPORT: IHeadless;
}

interface IRegistryModule {
  readonly resolvePipelineBankConfig: (
    company: CompanyTypes,
  ) => { readonly transport?: IHeadless } | false;
}

describe('Leumi native candidate configuration', () => {
  it('builds one bounded, private native flow and activates its registry config', async () => {
    const { LEUMI_API_DIRECT_CALL: call, LEUMI_TRANSPORT: headless } = (await import(
      MODULE
    )) as ILeumiModule;
    const validation = validateApiDirectConfig({ call, transport: headless });
    expect(validation).toEqual({ success: true, value: true });
    expect(call.sessionCarry).toEqual(['sessionToken']);
    expect(call.omitBankText).toBe(true);
    expect(headless).toMatchObject({
      nativeFetch: true,
      sessionCookies: true,
      redirectPolicy: 'reject',
      strictUtf8: true,
      omitBankText: true,
      responseIntegrity: { maxBytes: 4194304 },
    });
    const registry = (await import(REGISTRY)) as IRegistryModule;
    const active = registry.resolvePipelineBankConfig(CompanyTypes.Leumi);
    expect(active).toMatchObject({ transport: headless });
  });

  it('selects the native descriptor from the production pipeline registry', () => {
    const factory = PIPELINE_REGISTRY[CompanyTypes.Leumi];
    if (factory === undefined) throw new TypeError('missing Leumi factory');
    const result = factory({ companyId: CompanyTypes.Leumi, startDate: new Date('2026-01-01') });
    assertOk(result);
    const phases = result.value.phases.map(phase => phase.name);
    expect(phases).toEqual(['api-direct-call', 'api-direct-scrape']);
  });

  it('builds the honest runtime collection rather than a captured device fingerprint', async () => {
    const { LEUMI_API_DIRECT_CALL: call } = (await import(MODULE)) as ILeumiModule;
    if (call.fingerprint === undefined) throw new TypeError('missing collection configuration');
    const before = Date.now();
    const result = buildCollectionResult(call.fingerprint, call);
    const after = Date.now();
    expect(result).toMatchObject({
      success: true,
      value: {
        metadata: { physical_app_id: 'hb2.bankleumi.co.il' },
        content: { location: { enabled: false } },
      },
    });
    assertOk(result);
    if (typeof result.value !== 'object' || result.value === null)
      throw new TypeError('invalid synthetic fingerprint');
    const json = JSON.stringify(result.value);
    expect(json).toContain(`Node.js ${process.versions.node}`);
    expect(json).toContain(`"device_platform":"${process.platform}"`);
    const metadata: unknown = Reflect.get(result.value, 'metadata');
    if (typeof metadata !== 'object' || metadata === null)
      throw new TypeError('missing synthetic metadata');
    const timestamp: unknown = Reflect.get(metadata, 'timestamp');
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });
});
