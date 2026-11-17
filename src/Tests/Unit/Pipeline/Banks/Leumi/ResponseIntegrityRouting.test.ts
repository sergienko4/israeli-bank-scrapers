/**
 * Bank-default and step response integrity reach real native dispatch paths.
 */
import { CompanyTypes } from '../../../../../Definitions.js';
import type { ScraperOptions } from '../../../../../Scrapers/Base/Interface.js';
import LEUMI_SHAPE from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShape.js';
import { resolveApiMediator } from '../../../../../Scrapers/Pipeline/Core/ApiMediatorWiring.js';
import type { IPipelineDescriptor } from '../../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { IStepConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/RunStep.js';
import { registerWkQuery } from '../../../../../Scrapers/Pipeline/Registry/WK/QueriesWK.js';
import { registerWkUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { isSome, none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { fakeFetch } from '../../../../Helpers/FakeFetch.js';
import runScrapeAction from '../../../../Helpers/ScrapeAction.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

const ORIGIN = 'https://bank.example';

/** Leumi's bank-default response-integrity cap is 4 MiB; one byte more breaches it. */
const OVER_LEUMI_LIMIT = 'x'.repeat(4_194_305);

const ACCOUNT_BODY = {
  ProcessRequestResult: 0,
  jsonResp: JSON.stringify({ AccountsItems: [{ AccountIndex: 0, MaskedNumber: '99-12345/88' }] }),
  padding: OVER_LEUMI_LIMIT,
};

/**
 * Builds a mediator through the real transport wiring.
 * @returns The native mediator.
 */
function mediator(): IApiMediator {
  const options = { companyId: CompanyTypes.Leumi } as unknown as ScraperOptions;
  const descriptor: IPipelineDescriptor = { options, phases: [] };
  const option = resolveApiMediator(descriptor);
  if (!isSome(option)) throw new TypeError('Leumi resolved no mediator');
  return option.value;
}

describe('response integrity routing', () => {
  const originalFetch = globalThis.fetch;
  beforeAll(() => {
    registerWkUrl('auth.bootstrap', CompanyTypes.Leumi, `${ORIGIN}/bootstrap`);
    registerWkQuery('customer', CompanyTypes.Leumi, 'query Customer { me { id } }');
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('enforces the bank default on a real WCF customer dispatch before extraction', async () => {
    const fake = fakeFetch(() => Response.json(ACCOUNT_BODY));
    globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
    const bus = mediator();
    bus.setSessionContext({ sessionToken: 'synthetic-session' });
    const ctx = {
      ...makeMockContext({ apiMediator: some(bus) }),
      executor: none(),
      windowEnd: none(),
    };
    const outcome = await runScrapeAction(LEUMI_SHAPE)(ctx);
    expect(outcome).toMatchObject({
      success: false,
      errorMessage: 'response exceeds integrity byte limit',
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].init.signal?.aborted).toBe(true);
  });

  it('lets a login step choose a tighter limit than the bank default', async () => {
    const fake = fakeFetch(() => new Response('123456789'));
    globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
    const config = { flow: 'sms-otp', envelope: {}, steps: [] } as const;
    const step: IStepConfig = {
      name: 'bootstrap',
      urlTag: 'auth.bootstrap',
      method: 'GET',
      response: 'text',
      responseIntegrity: { maxBytes: 8 },
      extractsToCarry: {},
    };
    const scope = { carry: {}, creds: {}, config, keypair: undefined };
    const result = await runStep({ step, scope, bus: mediator(), companyId: CompanyTypes.Leumi });
    expect(result).toMatchObject({ success: false });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].init.signal?.aborted).toBe(true);
  });

  it('enforces the same default on GraphQL calls', async () => {
    const fake = fakeFetch(() => Response.json({ data: { id: OVER_LEUMI_LIMIT } }));
    globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
    const result = await mediator().apiQuery('customer', {});
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'response exceeds integrity byte limit',
    });
    expect(fake.calls[0].init.signal?.aborted).toBe(true);
  });
});
