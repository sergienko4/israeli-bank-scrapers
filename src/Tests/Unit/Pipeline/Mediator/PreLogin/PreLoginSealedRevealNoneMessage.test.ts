/**
 * PR #299 — PRE-LOGIN sealed-reveal NONE diagnostic.
 *
 * The legacy `'sealed-reveal: NONE (form already visible)'` log was
 * misleading: in the Isracard E2E Real A failure of 2026-06-03 the
 * pre-login form was NOT visible (a `target="_blank"` link had
 * silently opened the login page in a new BrowserContext page,
 * leaving the scraper on the marketing tab where neither a reveal
 * target NOR a form gate existed). The honest message must explain
 * that the POST gate is the authority that verifies the form, so
 * future failure traces are diagnostic instead of falsely
 * reassuring.
 *
 * Pure-additive `it()` cases — no existing test bodies modified.
 */

import { executeFireRevealClicksSealed } from '../../../../../Scrapers/Pipeline/Mediator/PreLogin/PreLoginPhaseActions.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Types/Debug.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IPreLoginDiscovery,
  IResolvedTarget,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { toActionCtx } from '../../../Pipeline/Infrastructure/TestHelpers.js';
import { makeMockContext } from '../../../Scrapers/Pipeline/MockPipelineFactories.js';

const MOCK_TARGET: IResolvedTarget = {
  selector: 'button',
  contextId: 'main',
  kind: 'textContent',
  candidateValue: 'Enter',
};

/** Captures every payload passed to logger.debug for assertion. */
interface ICapturingLogger {
  readonly messages: unknown[];
  /** Logger conforming to ScraperLogger for test injection. */
  readonly logger: ScraperLogger;
}

/**
 * Build a logger that captures every debug payload.
 * @returns Capturing logger.
 */
function makeCapturingLogger(): ICapturingLogger {
  const messages: unknown[] = [];
  /**
   * Record + return.
   * @param payload - Debug payload.
   * @returns True.
   */
  const debug = (payload: unknown): true => {
    messages.push(payload);
    return true;
  };
  /**
   * No-op stub for trace/info/warn/error.
   * @returns True.
   */
  const noop = (): true => true;
  const logger = {
    debug,
    trace: noop,
    info: noop,
    warn: noop,
    error: noop,
  } as unknown as ScraperLogger;
  return { messages, logger };
}

/**
 * Flatten captured debug payloads into the concatenated message text
 * so substring assertions stay readable.
 * @param cap - Capturing logger.
 * @returns Concatenated message string.
 */
function joinedMessageText(cap: ICapturingLogger): string {
  return cap.messages
    .map((m): string => {
      if (m && typeof m === 'object' && 'message' in m) return String(m.message);
      return JSON.stringify(m);
    })
    .join(' | ');
}

/**
 * Captures the canonical NONE-branch fixture shared by every test below.
 * Keeps the it() blocks additive and removes setup duplication (CR PR #299).
 */
interface INoneCaseSetup {
  readonly cap: ICapturingLogger;
  readonly ctx: ReturnType<typeof toActionCtx>;
}

/**
 * Build the IPreLoginDiscovery payload used by every NONE-branch case.
 * @returns Discovery shaped for NONE dispatch.
 */
function makeNoneDiscovery(): IPreLoginDiscovery {
  return {
    privateCustomers: 'READY',
    credentialArea: 'NOT_FOUND',
    revealAction: 'NONE',
    revealTarget: MOCK_TARGET,
  };
}

/**
 * Arrange the capturing logger + sealed action context for a NONE case.
 * @returns Capturing logger and ready-to-dispatch sealed action context.
 */
function arrangeNoneCase(): INoneCaseSetup {
  const cap = makeCapturingLogger();
  const disc = makeNoneDiscovery();
  const base = makeMockContext({
    preLoginDiscovery: some(disc),
    logger: cap.logger,
  });
  const ctx = toActionCtx(base, false);
  return { cap, ctx };
}

describe('PreLoginSealedReveal — NONE branch diagnostic (PR #299)', () => {
  it('emits the honest "no reveal target discovered" message on NONE', async () => {
    const { cap, ctx } = arrangeNoneCase();
    const result = await executeFireRevealClicksSealed(ctx);
    const isOkResult = isOk(result);
    expect(isOkResult).toBe(true);
    const joined = joinedMessageText(cap);
    expect(joined).toContain('no reveal target discovered');
    expect(joined).toContain('POST gate will verify form');
  });

  it('NO LONGER emits the misleading "form already visible" claim on NONE', async () => {
    const { cap, ctx } = arrangeNoneCase();
    await executeFireRevealClicksSealed(ctx);
    const joined = joinedMessageText(cap);
    expect(joined).not.toContain('form already visible');
  });
});
