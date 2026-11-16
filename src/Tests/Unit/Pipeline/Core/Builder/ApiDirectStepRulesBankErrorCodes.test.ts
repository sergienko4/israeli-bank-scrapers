/**
 * Build-time rules for the bank-error code map on login and resume steps:
 * the map needs code pointers, the pointers need a map, a pointer must be a
 * JSON pointer below the body root, and a map needs a guard or codec to raise
 * the bank error it types.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import type { IStepConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const POINTER_MSG = 'steps.bankErrorCodePointers: each entry must be a JSON pointer';
const MAP_NEEDS_POINTERS = 'steps.bankErrorTypeByCode: needs bankErrorCodePointers';
const POINTERS_NEED_MAP = 'steps.bankErrorCodePointers: needs bankErrorTypeByCode';
const IDLE_MSG = 'steps.bankErrorTypeByCode: needs failIfPresent or a codec';

/** The expired-password code and where the step reads it. */
const CODE_MAP = { E100129: ScraperErrorTypes.ChangePassword };
const CODE_POINTERS = ['/Error/ReturnedCode'];

/**
 * A login step with the given guard pointers.
 * @param pointers - The `failIfPresent` entries.
 * @returns Step config.
 */
function guarded(pointers: readonly string[]): IStepConfig {
  return {
    name: 'bind',
    urlTag: 'auth.bind',
    body: { shape: {} },
    extractsToCarry: {},
    failIfPresent: pointers,
  };
}

/**
 * Rule input running the step as the one login step.
 * @param step - The guarded step.
 * @returns Rule input.
 */
function runOf(step: IStepConfig): IApiDirectRuleInput {
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, transport: false };
}

describe('validateApiDirectConfig — bankErrorTypeByCode', () => {
  it('refuses a code pointer that is not a body pointer', () => {
    const step = {
      ...guarded(['/Error']),
      bankErrorCodePointers: ['Error'],
      bankErrorTypeByCode: CODE_MAP,
    };
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: POINTER_MSG });
  });

  it('refuses a map without code pointers', () => {
    const step = { ...guarded(['/Error']), bankErrorTypeByCode: CODE_MAP };
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: MAP_NEEDS_POINTERS });
  });

  it('refuses code pointers without a map', () => {
    const step = { ...guarded(['/Error']), bankErrorCodePointers: CODE_POINTERS };
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: POINTERS_NEED_MAP });
  });

  it('refuses a map with no guard or codec', () => {
    const step = {
      ...guarded([]),
      bankErrorCodePointers: CODE_POINTERS,
      bankErrorTypeByCode: CODE_MAP,
    };
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: IDLE_MSG });
  });

  it('a guarded, mapped step passes', () => {
    const step = {
      ...guarded(['/Error']),
      bankErrorCodePointers: CODE_POINTERS,
      bankErrorTypeByCode: CODE_MAP,
    };
    const input = runOf(step);
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
