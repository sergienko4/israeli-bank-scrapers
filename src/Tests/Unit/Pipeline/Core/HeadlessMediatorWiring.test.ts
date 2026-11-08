/**
 * Unit tests for Core/HeadlessMediatorWiring.resolveHeadlessApiMediator — the
 * transport selector. Asserts: a non-headless descriptor yields none(); a
 * headless bank with no headless config yields none(); OneZero (requiresClientCert)
 * yields a mTLS-backed mediator; PayBox (native fetch) yields a Node-fetch-backed
 * mediator. Construction only — no network is performed.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import {
  resolveHeadlessApiMediator,
  resolveHeadlessTransportKind,
} from '../../../../Scrapers/Pipeline/Core/HeadlessMediatorWiring.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import { isSome } from '../../../../Scrapers/Pipeline/Types/Option.js';

/**
 * Build a minimal descriptor for a bank with the given headless flag.
 * @param companyId - Target bank company type.
 * @param isHeadless - Whether the pipeline is headless (API-only).
 * @returns A descriptor sufficient for the wiring lookup.
 */
function makeDescriptor(companyId: CompanyTypes, isHeadless: boolean): IPipelineDescriptor {
  const options = { companyId } as unknown as ScraperOptions;
  return { options, phases: [], interceptors: [], isHeadless };
}

describe('resolveHeadlessApiMediator — none() cases', () => {
  it('returns none() when the descriptor is not headless', () => {
    const descriptor = makeDescriptor(CompanyTypes.OneZero, false);
    const option = resolveHeadlessApiMediator(descriptor);
    const isPresent = isSome(option);
    expect(isPresent).toBe(false);
  });

  it('returns none() when a headless bank has no headless config block', () => {
    const descriptor = makeDescriptor(CompanyTypes.Leumi, true);
    const option = resolveHeadlessApiMediator(descriptor);
    const isPresent = isSome(option);
    expect(isPresent).toBe(false);
  });
});

describe('resolveHeadlessApiMediator — some(mediator) cases', () => {
  it('wires a mTLS mediator for OneZero (requiresClientCert)', () => {
    const descriptor = makeDescriptor(CompanyTypes.OneZero, true);
    const option = resolveHeadlessApiMediator(descriptor);
    const isPresent = isSome(option);
    expect(isPresent).toBe(true);
    if (isSome(option)) {
      expect(typeof option.value.apiPost).toBe('function');
      expect(typeof option.value.apiQuery).toBe('function');
    }
  });

  it('wires a Node-fetch mediator for PayBox (nativeFetch)', () => {
    const descriptor = makeDescriptor(CompanyTypes.PayBox, true);
    const option = resolveHeadlessApiMediator(descriptor);
    const isPresent = isSome(option);
    expect(isPresent).toBe(true);
    if (isSome(option)) {
      expect(typeof option.value.apiPost).toBe('function');
      expect(option.value.drivesBrowser).toBeUndefined();
    }
  });
});

describe('resolveHeadlessTransportKind — Pepper and PayBox', () => {
  it.each([CompanyTypes.Pepper, CompanyTypes.PayBox])('selects native for %s', companyId => {
    const kind = resolveHeadlessTransportKind(companyId);
    expect(kind).toBe('native');
  });
});
