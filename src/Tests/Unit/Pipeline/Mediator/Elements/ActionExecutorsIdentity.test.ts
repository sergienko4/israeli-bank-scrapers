/**
 * Identity-based selector branch coverage for raceResultToTarget — every
 * tier of buildIdentitySelector + the hasAttr predicate. Extracted from
 * ActionExecutors.test.ts to keep both files under the 300-line gate.
 */

import type { Page } from 'playwright-core';

import { raceResultToTarget } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ActionExecutors.js';
import type { IRaceResult } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { makeFrame, makeLocator } from './ActionExecutorsHelpers.js';

const NONE_SENTINEL = '(none)';

/** Shared describe-scope mocks — same instances passed as both `context` on
 *  IRaceResult and as the second arg to raceResultToTarget so computeContextId
 *  sees `context === page` and short-circuits to 'main' without calling
 *  `frame.url()` (the helper mock doesn't implement it). */
const SHARED_LOCATOR = makeLocator();
const SHARED_PAGE: Page = makeFrame(SHARED_LOCATOR);

/**
 * Build a fully-populated IElementIdentity with overridable fields. Defaults
 * every attribute to the `(none)` sentinel so tests can pinpoint exactly
 * which branch of `buildIdentitySelector` they want to exercise.
 * @param overrides - Subset of identity fields to override.
 * @returns Identity object with sentinel defaults + overrides.
 */
function makeIdentity(
  overrides: Partial<{
    tag: string;
    id: string;
    classes: string;
    name: string;
    type: string;
    ariaLabel: string;
    title: string;
    href: string;
  }>,
): IRaceResult['identity'] {
  return {
    tag: 'BUTTON',
    id: NONE_SENTINEL,
    classes: NONE_SENTINEL,
    name: NONE_SENTINEL,
    type: NONE_SENTINEL,
    ariaLabel: NONE_SENTINEL,
    title: NONE_SENTINEL,
    href: NONE_SENTINEL,
    ...overrides,
  };
}

/**
 * Build a found IRaceResult carrying a given identity, with a fixed
 * fallback candidate so we can assert when identity-based selection bails
 * back to the candidate path.
 * @param identity - The IElementIdentity (or false) to attach.
 * @returns Synthetic found IRaceResult.
 */
function makeFoundResultWithIdentity(identity: IRaceResult['identity']): IRaceResult {
  return {
    found: true,
    locator: SHARED_LOCATOR,
    candidate: { kind: 'ariaLabel', value: 'fallback' },
    context: SHARED_PAGE,
    index: 0,
    value: '',
    identity,
  };
}

describe('raceResultToTarget — identity-based selector tiers', () => {
  const page = SHARED_PAGE;

  it('uses [id="…"] when id is present (tier 1)', () => {
    const identity = makeIdentity({ id: 'sendSms' });
    const result = makeFoundResultWithIdentity(identity);
    const target = raceResultToTarget(result, page);
    expect(target).not.toBe(false);
    if (target) expect(target.selector).toBe('[id="sendSms"]');
  });

  it('falls through to [name="…"] when id is "(none)" but name is set', () => {
    const identity = makeIdentity({ name: 'username' });
    const result = makeFoundResultWithIdentity(identity);
    const target = raceResultToTarget(result, page);
    if (target) expect(target.selector).toBe('[name="username"]');
  });

  it('falls through to [aria-label="…"] when id+name absent but aria-label set', () => {
    const identity = makeIdentity({ ariaLabel: 'Send' });
    const result = makeFoundResultWithIdentity(identity);
    const target = raceResultToTarget(result, page);
    if (target) expect(target.selector).toBe('[aria-label="Send"]');
  });

  it('falls through to [title="…"] when id+name+aria-label absent', () => {
    const identity = makeIdentity({ title: 'שלח' });
    const result = makeFoundResultWithIdentity(identity);
    const target = raceResultToTarget(result, page);
    if (target) expect(target.selector).toBe('[title="שלח"]');
  });

  it('falls through to [href="…"] for plain anchor without other attrs', () => {
    const identity = makeIdentity({ href: '/login' });
    const result = makeFoundResultWithIdentity(identity);
    const target = raceResultToTarget(result, page);
    if (target) expect(target.selector).toBe('[href="/login"]');
  });

  it('falls back to candidateToSelector when identity has no usable attribute', () => {
    const identity = makeIdentity({});
    const result = makeFoundResultWithIdentity(identity);
    const target = raceResultToTarget(result, page);
    // candidate.kind=ariaLabel, value=fallback → '[aria-label="fallback"]'.
    if (target) expect(target.selector).toBe('[aria-label="fallback"]');
  });

  it('falls back to candidate-based selector when identity is false', () => {
    const result: IRaceResult = {
      found: true,
      locator: SHARED_LOCATOR,
      candidate: { kind: 'textContent', value: 'Click me' },
      context: page,
      index: 0,
      value: '',
      identity: false,
    };
    const target = raceResultToTarget(result, page);
    if (target) expect(target.selector).toBe('text=Click me');
  });

  it('hasAttr rejects empty-string attributes (treated as absent)', () => {
    // id=empty, name=empty, aria-label=non-empty → aria-label wins.
    const identity = makeIdentity({ id: '', name: '', ariaLabel: 'Real' });
    const result = makeFoundResultWithIdentity(identity);
    const target = raceResultToTarget(result, page);
    if (target) expect(target.selector).toBe('[aria-label="Real"]');
  });
});
