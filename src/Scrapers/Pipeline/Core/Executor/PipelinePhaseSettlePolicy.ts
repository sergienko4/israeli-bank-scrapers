import type { IPipelineContext } from '../../Types/PipelineContext.js';

type SettleContext = Pick<IPipelineContext, 'apiMediator' | 'browser'>;

interface IPhaseSettlePolicy {
  readonly wait: boolean;
}

const WAIT: IPhaseSettlePolicy = { wait: true };
const SKIP: IPhaseSettlePolicy = { wait: false };

/**
 * Decide whether the active transport needs browser page-settle windows.
 * @param ctx - Browser and API-mediator capabilities.
 * @returns Settle policy for the active capabilities.
 */
export default function resolvePhaseSettlePolicy(ctx: SettleContext): IPhaseSettlePolicy {
  if (ctx.browser.has || !ctx.apiMediator.has) return WAIT;
  return SKIP;
}
