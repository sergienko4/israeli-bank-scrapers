/**
 * Unit tests for HomeProbe — waitForCredentialsForm mediator delegation.
 */

import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import waitForCredentialsForm from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeProbe.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

describe('waitForCredentialsForm', () => {
  it('delegates to mediator.resolveAndClick and returns its Procedure<IRaceResult>', async () => {
    let passedCandidates: readonly unknown[] | undefined;
    const mediator = {
      /**
       * resolveAndClick records the candidate list and returns scripted result.
       * @param candidates - Candidates to resolve.
       * @returns Procedure of not-found.
       */
      resolveAndClick: (candidates: readonly unknown[]) => {
        passedCandidates = candidates;
        const succeedResult1 = succeed(NOT_FOUND_RESULT);
        return Promise.resolve(succeedResult1);
      },
    } as unknown as IElementMediator;
    const result = await waitForCredentialsForm(mediator);
    expect(result.success).toBe(true);
    expect(passedCandidates).toBeDefined();
    const isArrayResult2 = Array.isArray(passedCandidates);
    expect(isArrayResult2).toBe(true);
  });

  it('propagates mediator-found race result', async () => {
    const found: IRaceResult = { ...NOT_FOUND_RESULT, found: true as const };
    const mediator = {
      /**
       * resolveAndClick returns found result.
       * @returns Procedure with found=true.
       */
      resolveAndClick: () => {
        const succeeded = succeed(found);
        return Promise.resolve(succeeded);
      },
    } as unknown as IElementMediator;
    const result = await waitForCredentialsForm(mediator);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value.found).toBe(true);
  });
});
