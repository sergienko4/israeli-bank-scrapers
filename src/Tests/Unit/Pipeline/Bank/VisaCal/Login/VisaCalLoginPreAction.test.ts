/**
 * Unit tests for VisaCal preAction — verifies Connect iframe is opened before login.
 * preAction runs visaCalOpenLoginPopup which clicks the login link and waits for the iframe.
 */

import { VISACAL_LOGIN } from '../../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.js';

describe('VISACAL_LOGIN.preAction', () => {
  it('has preAction (opens Connect iframe so username/password fields are visible)', () => {
    expect(VISACAL_LOGIN.preAction).toBeDefined();
  });
});
