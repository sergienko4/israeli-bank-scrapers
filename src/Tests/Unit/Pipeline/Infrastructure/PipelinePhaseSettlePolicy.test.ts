import resolvePhaseSettlePolicy from '../../../../Scrapers/Pipeline/Core/Executor/PipelinePhaseSettlePolicy.js';
import type { IApiMediator } from '../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.types.js';
import { none, some } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IBrowserState,
  IPipelineContext,
} from '../../../../Scrapers/Pipeline/Types/PipelineContext.js';

type SettleContext = Pick<IPipelineContext, 'apiMediator' | 'browser'>;

const BORROWED_API = {} as unknown as IApiMediator;
const BROWSER_STATE = {} as unknown as IBrowserState;

/**
 * Guard against accidental disposal in a pure policy test.
 * @returns A rejected promise if invoked.
 */
function unreachableDispose(): Promise<never> {
  const error = new Error('Settle policy must not dispose resources');
  return Promise.reject(error);
}

const OWNED_API = { dispose: unreachableDispose } as unknown as IApiMediator;

const CASES = [
  {
    label: 'browser pipeline before launch',
    apiMediator: none(),
    browser: none(),
    expected: true,
  },
  {
    label: 'browser pipeline after launch',
    apiMediator: none(),
    browser: some(BROWSER_STATE),
    expected: true,
  },
  {
    label: 'browser-backed headless mediator',
    apiMediator: some(OWNED_API),
    browser: none(),
    expected: true,
  },
  {
    label: 'native headless mediator',
    apiMediator: some(BORROWED_API),
    browser: none(),
    expected: false,
  },
  {
    label: 'browser API-direct mediator',
    apiMediator: some(BORROWED_API),
    browser: some(BROWSER_STATE),
    expected: true,
  },
] as const;

describe('PipelinePhaseSettlePolicy', () => {
  it.each(CASES)('T-SETTLE-1: $label', ({ apiMediator, browser, expected }) => {
    const ctx: SettleContext = { apiMediator, browser };
    const policy = resolvePhaseSettlePolicy(ctx);
    expect(policy.wait).toBe(expected);
  });
});
