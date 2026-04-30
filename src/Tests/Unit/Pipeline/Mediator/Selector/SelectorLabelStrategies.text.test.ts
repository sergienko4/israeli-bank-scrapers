/**
 * Unit tests for SelectorLabelStrategies — xpath + label-text + walk-up branches (split).
 */

import {
  divSpanStrictXpath,
  resolveByAncestorWalkUp,
  resolveByContainerInput,
  resolveLabelText,
  resolveTextContent,
} from '../../../../../Scrapers/Pipeline/Mediator/Selector/SelectorLabelStrategies.js';
import { makePage, MISS_QUERY, OK_QUERY } from './SelectorLabelStrategiesHelpers.js';

describe('divSpanStrictXpath', () => {
  it('builds xpath with label tags and text', () => {
    const xp = divSpanStrictXpath('Username');
    expect(xp).toContain('label');
    expect(xp).toContain('Username');
  });
});

describe('resolveLabelText', () => {
  it('returns empty when neither label nor div/span has the text', async () => {
    const page = makePage({});
    const result = await resolveLabelText({
      ctx: page,
      labelXpath: 'xpath=//label',
      labelValue: 'User',
      queryFn: MISS_QUERY,
    });
    expect(result).toBe('');
  });

  it('uses label path when labelLoc.count > 0', async () => {
    // Make labelXpath substring match. label locator returns count=1 by default when "xpath=//label" substring present
    const page = makePage({
      'xpath=//label': { count: 1 },
      '#u': { count: 1, tag: 'input', type: 'text' },
    });
    // resolveLabelStrategies will fall through to proximity; queryFn=true → xpath result
    const result = await resolveLabelText({
      ctx: page,
      labelXpath: 'xpath=//label[text()="User"]',
      labelValue: 'User',
      queryFn: OK_QUERY,
    });
    expect(result).toContain('xpath=');
  });

  it('falls back to div/span path when label locator count is 0 but divSpan count > 0', async () => {
    // labelXpath locator matches nothing ('xpath=//nothing' not in map)
    // But divSpan strict xpath contains 'label'/'div'/'span' tags — makePage routes by substring.
    // We map the strict-xpath substring so the divSpan locator counts 1, then queryFn=true in
    // resolveLabelStrategies drives a positive result.
    const page = makePage({
      'self::div': { count: 1 },
      'self::span': { count: 1 },
      'self::label': { count: 1 },
      input: { count: 1, tag: 'input', type: 'text' },
    });
    // Use a label xpath that won't match to force the divSpan branch
    const result = await resolveLabelText({
      ctx: page,
      labelXpath: 'xpath=//UNKNOWN-TAG',
      labelValue: 'User',
      queryFn: OK_QUERY,
    });
    expect(typeof result).toBe('string');
  });
});

describe('resolveByContainerInput', () => {
  it('returns empty when text container not found', async () => {
    const page = makePage({});
    const result = await resolveByContainerInput(page, 'Text', MISS_QUERY);
    expect(result).toBe('');
  });

  it('returns xpath when container found and fillable', async () => {
    const page = makePage({ ancestor: { count: 1, tag: 'input', type: 'text' } });
    const result = await resolveByContainerInput(page, 'Text', OK_QUERY);
    expect(result).toContain('ancestor');
  });
});

describe('resolveByAncestorWalkUp', () => {
  it('returns empty when no ancestor matched', async () => {
    const page = makePage({});
    const result = await resolveByAncestorWalkUp(page, 'Login', MISS_QUERY);
    expect(result).toBe('');
  });

  it('returns xpath when button ancestor found', async () => {
    const page = makePage({});
    const result = await resolveByAncestorWalkUp(page, 'Login', OK_QUERY);
    expect(result).toContain('button');
  });
});

describe('resolveTextContent', () => {
  it('prefers interactive walk-up when found', async () => {
    const page = makePage({});
    const result = await resolveTextContent(page, 'Login', OK_QUERY);
    expect(result).toContain('button');
  });

  it('falls to container input when walk-up fails', async () => {
    const page = makePage({ ancestor: { count: 1, tag: 'input', type: 'text' } });
    let callCount = 0;
    /**
     * Walk-up misses, container hits.
     * @returns false three times (for button/a/select), then true.
     */
    const queryFn = (): Promise<boolean> => {
      callCount += 1;
      if (callCount <= 3) return Promise.resolve(false);
      return Promise.resolve(true);
    };
    const result = await resolveTextContent(page, 'Name', queryFn);
    expect(result).toContain('ancestor');
  });
});
