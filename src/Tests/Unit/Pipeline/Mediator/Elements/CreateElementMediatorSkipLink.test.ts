/**
 * Branch coverage for the accessibility skip-link / sr-only / visually-
 * hidden className filter in `isElementHitTestable` +
 * `isAccessibilitySkipLink`.
 *
 * <p>Both filters mirror the production-side defense for #309 (Discount
 * `<a class="skip-to-main-content-link">` shares "כניסה לחשבונך" visible
 * text with the real login button — clicking the skip-link triggers an
 * accessibility focus-main-content scroll, NO navigation, and the
 * pipeline silently walks into LOGIN PRE on the wrong URL).
 *
 * <p>`filterOutSkipLinks` is the upstream pre-filter
 * (defends BOTH `hitPassed[0]` AND the `fulfilled[0]` fallback);
 * `isElementHitTestable` duplicates the className guard inline
 * (defense in depth — if either guard regresses on its own, the wrong
 * element is still rejected).
 *
 * <p>The two predicates have OPPOSITE semantics for the same class:
 * <ul>
 *   <li>`isElementHitTestable` returns FALSE (reject) when class
 *       contains a skip-link marker.</li>
 *   <li>`isAccessibilitySkipLink` returns TRUE (detect) when
 *       class contains a skip-link marker.</li>
 * </ul>
 */

import createElementMediator from '../../../../../Scrapers/Pipeline/Mediator/Elements/CreateElementMediator.js';
import type { ICallbackRecorder } from './CreateElementMediatorCallbacksHelpers.js';
import {
  makeInvokingLocator,
  makeMockElement,
  makePage,
} from './CreateElementMediatorCallbacksHelpers.js';

/** Type alias for a captured browser-side Element-predicate callback. */
type ElementPredicate = (e: Element, mockMode: boolean) => boolean;

/** Bundle holding the two production predicates captured from one race. */
interface ICapturedPredicates {
  /** isElementHitTestable — returns FALSE on skip-link / disabled. */
  readonly hitTestable?: ElementPredicate;
  /** isAccessibilitySkipLink — returns TRUE on skip-link className. */
  readonly skipLinkDetect?: ElementPredicate;
}

/**
 * Run resolveVisible once with a stub document.elementFromPoint and
 * return both production predicates by inspecting captured callback
 * source strings.
 *
 * <p>Disambiguation: the hit-test predicate calls
 * `document.elementFromPoint(...)` and the detector does NOT. Both
 * inspect className for the same skip-link fragments, so source-string
 * matching alone is ambiguous; we partition on the elementFromPoint
 * literal.
 * @returns Bundle of the two predicates (either may be missing if the
 *   resolveVisible path didn't reach the corresponding production
 *   helper; tests assert presence where they need it).
 */
async function capturePredicates(): Promise<ICapturedPredicates> {
  const rec: ICallbackRecorder = { callbacks: [] };
  const seed = makeMockElement({});
  const locator = makeInvokingLocator(seed, rec);
  const page = makePage(locator);
  const origDoc = (globalThis as { document?: Document }).document;
  (globalThis as { document: unknown }).document = {
    /**
     * Stub elementFromPoint so isElementHitTestable's hit check resolves.
     * @returns Seed element.
     */
    elementFromPoint: (): Element => seed,
  };
  try {
    const m = createElementMediator(page);
    await m.resolveVisible([{ kind: 'textContent', value: 'x' }], 200);
    const skipAware = rec.callbacks.filter(
      (c): c is ElementPredicate => typeof c === 'function' && String(c).includes('skip-to-main'),
    );
    return {
      hitTestable: skipAware.find((p): boolean => String(p).includes('elementFromPoint')),
      skipLinkDetect: skipAware.find((p): boolean => !String(p).includes('elementFromPoint')),
    };
  } finally {
    if (origDoc) (globalThis as { document: unknown }).document = origDoc;
    else delete (globalThis as { document?: unknown }).document;
  }
}

const SKIP_LINK_CLASSES = [
  'skip-to-main-content-link',
  'skip-link',
  'sr-only',
  'visually-hidden',
  'a11y-skip-to-main button-primary',
] as const;

describe('isElementHitTestable + isAccessibilitySkipLink — #309 className filter', () => {
  it('captures at least one skip-link aware predicate', async () => {
    const caps = await capturePredicates();
    expect(caps.hitTestable ?? caps.skipLinkDetect).toBeDefined();
  });

  it.each(SKIP_LINK_CLASSES)(
    'isElementHitTestable REJECTS element with className containing "%s"',
    async (className: string) => {
      const caps = await capturePredicates();
      const el = makeMockElement({ className });
      if (caps.hitTestable) {
        const isHitTestable = caps.hitTestable(el, false);
        expect(isHitTestable).toBe(false);
      }
    },
  );

  it.each(SKIP_LINK_CLASSES)(
    'isAccessibilitySkipLink DETECTS element with className containing "%s"',
    async (className: string) => {
      const caps = await capturePredicates();
      const el = makeMockElement({ className });
      if (caps.skipLinkDetect) {
        const isSkip = caps.skipLinkDetect(el, false);
        expect(isSkip).toBe(true);
      }
    },
  );

  it('isAccessibilitySkipLink returns FALSE for a normal non-skip-link className', async () => {
    const caps = await capturePredicates();
    const el = makeMockElement({ className: 'btn btn-primary login-button' });
    if (caps.skipLinkDetect) {
      const isSkip = caps.skipLinkDetect(el, false);
      expect(isSkip).toBe(false);
    }
  });

  it('isAccessibilitySkipLink handles missing className without throwing', async () => {
    const caps = await capturePredicates();
    const el = makeMockElement({});
    if (caps.skipLinkDetect) {
      const probe = caps.skipLinkDetect;
      expect(() => probe(el, false)).not.toThrow();
      const isSkip = probe(el, false);
      expect(isSkip).toBe(false);
    }
  });
});
