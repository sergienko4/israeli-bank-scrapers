/**
 * Terminal guards over Procedure outcomes: a success is never blocked or
 * terminal, a WAF block is terminal, and an integrity refusal is terminal.
 */

import { ScraperErrorTypes } from '../../../../Scrapers/Base/ErrorTypes.js';
import {
  fail,
  isTerminalFailure,
  isWafBlocked,
  succeed,
} from '../../../../Scrapers/Pipeline/Types/Procedure.js';

describe('Procedure terminal guards', () => {
  it('treats a success as neither blocked nor terminal', (): void => {
    const result = succeed(1);
    const isBlocked = isWafBlocked(result);
    const isTerminal = isTerminalFailure(result);
    expect(isBlocked).toBe(false);
    expect(isTerminal).toBe(false);
  });

  it('treats a WAF block as terminal', (): void => {
    const failure = fail(ScraperErrorTypes.WafBlocked, 'edge block');
    const isBlocked = isWafBlocked(failure);
    const isTerminal = isTerminalFailure(failure);
    expect(isBlocked).toBe(true);
    expect(isTerminal).toBe(true);
  });

  it('treats an integrity refusal as terminal', (): void => {
    const refusal = { ...fail(ScraperErrorTypes.Generic, 'digest mismatch') };
    const failure = { ...refusal, responseIntegrityRefusal: true as const };
    const isTerminal = isTerminalFailure(failure);
    expect(isTerminal).toBe(true);
  });
});
