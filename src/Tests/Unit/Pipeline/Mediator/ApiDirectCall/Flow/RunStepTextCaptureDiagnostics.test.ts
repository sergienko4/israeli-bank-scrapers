import { jest } from '@jest/globals';

import type { IGetStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const LOG = { debug: jest.fn<boolean, [unknown]>() };

jest.unstable_mockModule('../../../../../../Scrapers/Pipeline/Logging/Debug.js', () => ({
  /**
   * Bind the diagnostic writer to a typed logger double.
   * @returns Shared logger double.
   */
  getDebug: (): typeof LOG => LOG,
}));

const CAPTURE =
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Captures/RunStep.textCapture.js');

const SECRET = 'private-bootstrap-value';
const BODY =
  `<HTML><title>${SECRET}</title><FORM action="/${SECRET}">` +
  `<input value="${SECRET}"><script>const token="${SECRET}";</script>` +
  '<iframe></iframe></FORM><formless></formless></HTML>';

/**
 * Build a text step without repeating unrelated transport configuration.
 * @param pattern - The capture's regular expression.
 * @param absent - Whether a match must be refused.
 * @returns A text GET step.
 */
function stepWith(pattern: string, absent = false): IGetStep {
  const guard = absent ? { absent: true as const } : {};
  return {
    name: 'prime',
    method: 'GET',
    urlTag: 'auth.bind',
    response: 'text',
    extractsToCarry: {},
    textCaptures: { slot: { pattern, group: 0, ...guard } },
  };
}

beforeEach(() => LOG.debug.mockClear());

describe('text capture refusal diagnostics', () => {
  it.each([
    { reason: 'missing', pattern: 'not-present', absent: false },
    { reason: 'ambiguous', pattern: 'private-bootstrap-value', absent: false },
    { reason: 'present', pattern: '<title>', absent: true },
  ])('logs only fixed structural hints for $reason', ({ reason, pattern, absent }) => {
    const step = stepWith(pattern, absent);
    const result = CAPTURE.captureText(step, { text: BODY });
    const logged = JSON.stringify(LOG.debug.mock.calls);

    expect(result).toMatchObject({
      success: false,
      errorMessage: `prime capture slot ${reason}`,
    });
    expect(LOG.debug).toHaveBeenCalledWith({
      stepName: 'prime',
      slot: 'slot',
      reason,
      textLength: BODY.length,
      tagCounts: { html: 1, title: 1, form: 1, input: 1, script: 1, iframe: 1 },
      message: '[textCapture] refused',
    });
    expect(logged).not.toContain(SECRET);
  });

  it('does not log successful captures', () => {
    const step = stepWith('unique');
    const result = CAPTURE.captureText(step, { text: `unique ${SECRET}` });
    expect(result).toMatchObject({ success: true, value: { slot: 'unique' } });
    expect(LOG.debug).not.toHaveBeenCalled();
  });

  it('reports zero tag counts for non-HTML text without logging its contents', () => {
    const step = stepWith('not-present');
    CAPTURE.captureText(step, { text: SECRET });
    const diagnostic = LOG.debug.mock.calls[0]?.[0];
    expect(diagnostic).toMatchObject({
      textLength: SECRET.length,
      tagCounts: { html: 0, title: 0, form: 0, input: 0, script: 0, iframe: 0 },
    });
    const logged = JSON.stringify(LOG.debug.mock.calls);
    expect(logged).not.toContain(SECRET);
  });

  it('counts a large response without copying tag matches into the diagnostic', () => {
    const body = '<input/>'.repeat(100_000);
    const step = stepWith('not-present');
    CAPTURE.captureText(step, { text: body });
    const diagnostic = LOG.debug.mock.calls[0]?.[0];
    expect(diagnostic).toMatchObject({
      textLength: 800_000,
      tagCounts: { html: 0, title: 0, form: 0, input: 100_000, script: 0, iframe: 0 },
    });
    const logged = JSON.stringify(LOG.debug.mock.calls);
    expect(logged.length).toBeLessThan(300);
  });
});
