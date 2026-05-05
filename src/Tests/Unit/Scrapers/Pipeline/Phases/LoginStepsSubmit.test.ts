/**
 * Unit tests for LoginSteps.ts — normalizeSubmit branch.
 * Covers the case where submit config is a single candidate, not an array.
 */

import type { ILoginConfig } from '../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { createLoginPhase } from '../../../../../Scrapers/Pipeline/Mediator/Login/LoginSteps.js';
import type { IFieldContext } from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  makeContextWithLogin,
  makeMockFullPage,
  makeMockMediator,
} from '../MockPipelineFactories.js';

/**
 * Create a minimal ILoginConfig stub.
 * @param overrides - Optional field overrides.
 * @returns Minimal ILoginConfig.
 */
const MAKE_LOGIN_CONFIG = (overrides: Partial<ILoginConfig> = {}): ILoginConfig => ({
  loginUrl: 'https://bank.test/login',
  fields: [],
  submit: [{ kind: 'textContent', value: 'כניסה' }],
  possibleResults: { success: [] },
  ...overrides,
});

/** Minimal success IFieldContext for mediator mock return. */
const SUCCESS_FIELD_CTX: IFieldContext = {
  isResolved: true,
  selector: '#field',
  context: makeMockFullPage(),
  resolvedVia: 'wellKnown',
  round: 'mainPage',
};

describe('LoginSteps/normalizeSubmit', () => {
  it('handles single submit candidate (not array)', async () => {
    const ctx = makeContextWithLogin();
    const mediator = makeMockMediator({
      /**
       * Succeed for fields.
       * @returns Succeed with field context.
       */
      resolveField: () => {
        const r = succeed(SUCCESS_FIELD_CTX);
        return Promise.resolve(r);
      },
      /**
       * Succeed for submit.
       * @returns Succeed with field context.
       */
      resolveClickable: () => {
        const r = succeed(SUCCESS_FIELD_CTX);
        return Promise.resolve(r);
      },
    });
    const mediatorSome = some(mediator);
    const withMediator = { ...ctx, mediator: mediatorSome };
    const config = MAKE_LOGIN_CONFIG({
      submit: { kind: 'textContent', value: 'כניסה' },
    });
    const phase = createLoginPhase(config);
    const result = await phase.action.execute(withMediator, withMediator);
    expect(result.success).toBe(true);
  });
});
