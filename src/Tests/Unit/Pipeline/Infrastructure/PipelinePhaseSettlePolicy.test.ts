import { CompanyTypes } from '../../../../Definitions.js';
import resolvePhaseSettlePolicy from '../../../../Scrapers/Pipeline/Core/Executor/PipelinePhaseSettlePolicy.js';
import {
  createHeadlessApiMediator,
  createMtlsHeadlessApiMediator,
} from '../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.factories.js';
import type { IApiMediator } from '../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';

type SettleContext = Pick<IPipelineContext, 'apiMediator' | 'browser'>;

const BROWSER_STATE = {} as unknown as IBrowserState;
const URLS = {
  bankHint: CompanyTypes.OneZero,
  identityBaseUrl: 'https://id.example/v1/',
  graphqlUrl: 'https://gql.example/graphql',
};

/**
 * Stand-in cleanup hook; the policy must decide without running it.
 * @returns A settled promise.
 */
function idleCleanup(): Promise<void> {
  return Promise.resolve();
}

const NATIVE_API = createHeadlessApiMediator(URLS);
const NODE_TLS_API = createMtlsHeadlessApiMediator(URLS);
const NATIVE_WITH_CLEANUP: IApiMediator = {
  ...createHeadlessApiMediator(URLS),
  dispose: idleCleanup,
};

const CASES = [
  { label: 'browser pipeline before launch', apiMediator: none(), browser: none(), wait: true },
  {
    label: 'browser pipeline after launch',
    apiMediator: none(),
    browser: some(BROWSER_STATE),
    wait: true,
  },
  {
    label: 'native headless mediator',
    apiMediator: some(NATIVE_API),
    browser: none(),
    wait: false,
  },
  {
    label: 'node-TLS headless mediator',
    apiMediator: some(NODE_TLS_API),
    browser: none(),
    wait: false,
  },
  {
    label: 'native mediator that owns a cleanup hook',
    apiMediator: some(NATIVE_WITH_CLEANUP),
    browser: none(),
    wait: false,
  },
  {
    label: 'browser API-direct mediator',
    apiMediator: some(NATIVE_API),
    browser: some(BROWSER_STATE),
    wait: true,
  },
] as const;

describe('PipelinePhaseSettlePolicy', () => {
  it.each(CASES)('T-SETTLE-1: $label', ({ apiMediator, browser, wait }) => {
    const ctx: SettleContext = { apiMediator, browser };
    const policy = resolvePhaseSettlePolicy(ctx);
    expect(policy.wait).toBe(wait);
  });
});
