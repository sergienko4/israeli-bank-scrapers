/**
 * Unit tests for VisaCal preAction — verifies generic architecture (no preAction).
 * HOME phase handles all pre-login navigation via mediator.
 */

import { VISACAL_LOGIN } from '../../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.js';

describe('VISACAL_LOGIN.preAction', () => {
  it('has no preAction — pipeline mediator handles navigation', () => {
    expect(VISACAL_LOGIN).not.toHaveProperty('preAction');
  });
});
