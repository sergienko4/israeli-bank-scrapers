/**
 * Unit tests for RecipeStepTypes — discriminated-union type guards.
 */

import {
  type IGotoStep,
  type IHarvestStep,
  type ILoginStep,
  type IRecordResponseStep,
  type IRevealStep,
  isLoginStep,
  isRecordResponseStep,
} from '../../../Integration/Tools/RecipeStepTypes.js';

describe('RecipeStepTypes', () => {
  it('isLoginStep narrows on kind=login', () => {
    const login: ILoginStep = { kind: 'login', stepName: '04-login' };
    const reveal: IRevealStep = { kind: 'reveal', stepName: '03', revealText: 'go' };
    const isLoginRecognised = isLoginStep(login);
    const isRevealMisclassifiedAsLogin = isLoginStep(reveal);
    expect(isLoginRecognised).toBe(true);
    expect(isRevealMisclassifiedAsLogin).toBe(false);
  });

  it('isRecordResponseStep narrows on kind=recordResponse', () => {
    const record: IRecordResponseStep = {
      kind: 'recordResponse',
      stepName: '10',
      urlPattern: '/api/x',
      captureAs: 'x',
    };
    const goto: IGotoStep = { kind: 'goto', stepName: '01', url: 'https://a' };
    const isRecordRecognised = isRecordResponseStep(record);
    const isGotoMisclassifiedAsRecord = isRecordResponseStep(goto);
    expect(isRecordRecognised).toBe(true);
    expect(isGotoMisclassifiedAsRecord).toBe(false);
  });

  it('compiles the full discriminated union without leaks', () => {
    const steps: readonly IHarvestStep[] = [
      { kind: 'goto', stepName: '01', url: 'https://a' },
      { kind: 'reveal', stepName: '02', revealText: 'login' },
      { kind: 'login', stepName: '03' },
      { kind: 'waitFor', stepName: '04', urlIncludes: '/dashboard' },
      { kind: 'snapshot', stepName: '05', waitForLifecycle: 'networkidle' },
      { kind: 'recordResponse', stepName: '06', urlPattern: '/api', captureAs: 'x' },
    ];
    const kinds = steps.map(step => step.kind);
    const sortedKinds = [...kinds].sort();
    const expected = ['goto', 'login', 'recordResponse', 'reveal', 'snapshot', 'waitFor'];
    expect(sortedKinds).toEqual(expected);
  });
});
