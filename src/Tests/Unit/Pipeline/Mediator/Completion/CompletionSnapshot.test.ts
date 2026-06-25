/**
 * Unit coverage for {@link captureCompletionSignals} — proves it composes
 * the four narrow ports into one signals snapshot, independent of any
 * Playwright / phase wiring (fakes supply the port booleans).
 */

import { jest } from '@jest/globals';

import { captureCompletionSignals } from '../../../../../Scrapers/Pipeline/Mediator/Completion/CompletionSnapshot.js';
import type { ICompletionPorts } from '../../../../../Scrapers/Pipeline/Mediator/Completion/CompletionTypes.js';

/** Fixed port return values for a fake. */
interface IFakePortValues {
  readonly spinner: boolean;
  readonly error: boolean;
  readonly advanced: boolean;
  readonly formPresent: boolean;
}

/**
 * Build fake completion ports returning fixed booleans.
 * @param v - Port return values.
 * @returns Completion ports backed by constants.
 */
function makePorts(v: IFakePortValues): ICompletionPorts {
  return {
    isSpinnerVisible: jest.fn<Promise<boolean>, []>().mockResolvedValue(v.spinner),
    hasError: jest.fn<Promise<boolean>, []>().mockResolvedValue(v.error),
    isFormPresent: jest.fn<Promise<boolean>, []>().mockResolvedValue(v.formPresent),
    hasAdvanced: jest.fn<boolean, []>().mockReturnValue(v.advanced),
  };
}

describe('captureCompletionSignals', () => {
  it('advanced + no spinner + no error → advanced:true, clear signals', async () => {
    const ports = makePorts({ spinner: false, error: false, advanced: true, formPresent: false });
    const snap = await captureCompletionSignals(ports);
    expect(snap).toEqual({
      spinnerVisible: false,
      hasError: false,
      advanced: true,
      formPresent: false,
    });
  });

  it('stuck spinner + not advanced → spinnerVisible:true, advanced:false', async () => {
    const ports = makePorts({ spinner: true, error: false, advanced: false, formPresent: true });
    const snap = await captureCompletionSignals(ports);
    expect(snap).toEqual({
      spinnerVisible: true,
      hasError: false,
      advanced: false,
      formPresent: true,
    });
  });

  it('error present is surfaced in the snapshot', async () => {
    const ports = makePorts({ spinner: false, error: true, advanced: false, formPresent: false });
    const snap = await captureCompletionSignals(ports);
    expect(snap.hasError).toBe(true);
  });
});
