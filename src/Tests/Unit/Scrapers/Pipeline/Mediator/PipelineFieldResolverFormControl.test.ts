/**
 * Unit tests for the form-control guard applied to resolved field targets.
 *
 * Reproduces the Yahav case where a `textContent` walk-up on "תעודת זהות" landed on
 * an anchor on a maintenance page instead of the credential input, and pins the
 * deliberate narrowness of the predicate: `<input type="date">` (dashboard date
 * navigation) must still be accepted even though its type is absent from
 * FILLABLE_INPUT_TYPES.
 */

import { jest } from '@jest/globals';
import type { Frame, Page } from 'playwright-core';

import type { IFieldContext } from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorResolverPipeline.js';

interface IMockMeta {
  tag: string;
  type: string;
  role: string;
  tabindex: string;
}

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorLabelStrategies.elements.js',
  () => ({ extractElementMeta: jest.fn() }),
);

const ELEMENTS_MOD =
  await import('../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorLabelStrategies.elements.js');
const GUARD_MOD =
  await import('../../../../../Scrapers/Pipeline/Mediator/Selector/PipelineFieldResolver.formControl.js');
const FACTORY = await import('../MockPipelineFactories.js');

const EXTRACT = ELEMENTS_MOD.extractElementMeta as unknown as jest.Mock;
const REJECT = GUARD_MOD.rejectNonFormControl;

/** Shared mock context — never queried because extraction is mocked. */
const MOCK_CTX = FACTORY.makeMockFullPage() as Page | Frame;

/**
 * Build a resolved field context for the given selector.
 * @param selector - Selector the probe claims to have resolved.
 * @returns A resolved IFieldContext.
 */
function resolved(selector: string): IFieldContext {
  return {
    isResolved: true,
    selector,
    context: MOCK_CTX,
    resolvedVia: 'wellKnown',
    round: 'mainPage',
  };
}

/**
 * Build an element-metadata stub.
 * @param tag - Lower-case tag name.
 * @param type - Input type attribute.
 * @returns Metadata stub for extractElementMeta.
 */
function meta(tag: string, type: string): IMockMeta {
  return { tag, type, role: '', tabindex: '' };
}

describe('rejectNonFormControl', () => {
  beforeEach(() => {
    EXTRACT.mockReset();
  });

  it('rejects an anchor returned by a text walk-up', async () => {
    const anchorMeta = meta('a', '');
    EXTRACT.mockResolvedValue(anchorMeta);
    const hit = resolved('xpath=//a[.//text()[contains(., "תעודת זהות")]]');
    const out = await REJECT(hit, 'nationalID');
    expect(out.isResolved).toBe(false);
    expect(out.selector).toBe('');
    expect(out.resolvedVia).toBe('notResolved');
  });

  it('rejects a div returned by a text walk-up', async () => {
    const divMeta = meta('div', '');
    EXTRACT.mockResolvedValue(divMeta);
    const hit = resolved('xpath=//div');
    const out = await REJECT(hit, 'password');
    expect(out.isResolved).toBe(false);
  });

  it('accepts a text input', async () => {
    const inputMeta = meta('input', 'text');
    EXTRACT.mockResolvedValue(inputMeta);
    const hit = resolved('#num');
    const out = await REJECT(hit, 'num');
    expect(out.isResolved).toBe(true);
    expect(out.selector).toBe('#num');
  });

  it('accepts a date input whose type is outside FILLABLE_INPUT_TYPES', async () => {
    const dateMeta = meta('input', 'date');
    EXTRACT.mockResolvedValue(dateMeta);
    const hit = resolved('#dateFrom');
    const out = await REJECT(hit, 'dateFrom');
    expect(out.isResolved).toBe(true);
  });

  it('accepts a textarea', async () => {
    const areaMeta = meta('textarea', '');
    EXTRACT.mockResolvedValue(areaMeta);
    const hit = resolved('#notes');
    const out = await REJECT(hit, 'notes');
    expect(out.isResolved).toBe(true);
  });

  it('passes an already not-resolved result through without inspecting the DOM', async () => {
    const miss: IFieldContext = {
      isResolved: false,
      selector: '',
      context: MOCK_CTX,
      resolvedVia: 'notResolved',
      round: 'notResolved',
    };
    const out = await REJECT(miss, 'num');
    expect(out).toBe(miss);
    expect(EXTRACT).not.toHaveBeenCalled();
  });

  it('stays permissive when the element cannot be inspected', async () => {
    const detached = new TypeError('detached frame');
    EXTRACT.mockRejectedValue(detached);
    const hit = resolved('#num');
    const out = await REJECT(hit, 'num');
    expect(out.isResolved).toBe(true);
  });

  it('rejects when the element is absent', async () => {
    EXTRACT.mockResolvedValue(false);
    const hit = resolved('#gone');
    const out = await REJECT(hit, 'num');
    expect(out.isResolved).toBe(false);
  });
});
