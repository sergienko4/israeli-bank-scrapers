/**
 * Edge-case cover for the evidence ledger's two load-bearing properties.
 *
 * The ledger exists because five guardrails run repeatedly per account — once
 * per page, again per backfill round — and the classifier reads them once at
 * the end. Both properties below are what make that safe: without monotonicity
 * a later clean round erases an earlier loss, and without a fixed report order
 * the same set of observations produces different arrays depending on the order
 * pages happened to arrive in.
 *
 * The wiring itself is covered end-to-end in ApiDirectScrapeBackfill.test.ts;
 * this file is only for the properties too small to see from there.
 */

import { makeEvidenceLedger } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/CoverageAudit/EvidenceLedger.js';

describe('EvidenceLedger', () => {
  it('reports nothing when no guardrail spoke', () => {
    const ledger = makeEvidenceLedger();
    const reported = ledger.caveats();
    expect(reported).toEqual([]);
  });

  it('reports a caveat once however many times it fired', () => {
    const ledger = makeEvidenceLedger();
    ledger.note('mappingRejectedRows');
    ledger.note('mappingRejectedRows');
    ledger.note('mappingRejectedRows');
    const reported = ledger.caveats();
    expect(reported).toEqual(['mappingRejectedRows']);
  });

  it('keeps a caveat that fired — nothing can clear it', () => {
    const ledger = makeEvidenceLedger();
    ledger.note('declaredRowShortfall');
    ledger.noteWhen('declaredRowShortfall', false);
    const reported = ledger.caveats();
    expect(reported).toEqual(['declaredRowShortfall']);
  });

  it('records nothing when the condition did not hold', () => {
    const ledger = makeEvidenceLedger();
    ledger.noteWhen('extractionShortfall', false);
    const reported = ledger.caveats();
    expect(reported).toEqual([]);
  });

  it('reports in a fixed order, not the order observations arrived', () => {
    const forward = makeEvidenceLedger();
    forward.note('paginationStoppedEarly');
    forward.note('walkOrderViolated');
    const backward = makeEvidenceLedger();
    backward.note('walkOrderViolated');
    backward.note('paginationStoppedEarly');
    const forwardOrder = forward.caveats();
    const backwardOrder = backward.caveats();
    expect(backwardOrder).toEqual(forwardOrder);
    expect(forwardOrder).toEqual(['paginationStoppedEarly', 'walkOrderViolated']);
  });

  it('gives each account its own ledger', () => {
    const first = makeEvidenceLedger();
    const second = makeEvidenceLedger();
    first.note('extractionAuditUnavailable');
    const reported = second.caveats();
    expect(reported).toEqual([]);
  });
});
