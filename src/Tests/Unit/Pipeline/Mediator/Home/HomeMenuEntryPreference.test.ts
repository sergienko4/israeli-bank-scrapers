/**
 * T-HOMEMENU — a SEQUENTIAL toggle's revealed login link must win over the
 * toggle itself on the next discovery.
 *
 * <p>Max's `#personal-entrance` is an href-less menu toggle: clicking it opens a
 * dropdown holding `<a id="private" href="/login…">לקוחות פרטיים</a>`. That link
 * does not exist in the DOM until the toggle is clicked, so HOME's first
 * discovery can only see the toggle, clicks it, and POST fails — which is what
 * drives the sanitization pulse and a second discovery. The second discovery
 * must prefer the revealed link, or HOME re-clicks the toggle and closes the
 * menu it just opened. That is exactly what shipped: `WK_HOME.MENU` had no
 * consumer, so the revealed link was never a candidate.
 *
 * <p>Selection requires a real href. The pre-Phase-6 second click re-resolved
 * by raw `text=<value>` against an unscoped locator and could land on a
 * different element sharing the visible text — the documented "Max BoG"
 * regression. T-HOMEMENU-2 pins that a same-text decoy without an href is
 * never selected.
 */

import type { SelectorCandidate } from '../../../../../Scrapers/Base/Config/LoginConfigTypes.js';
import type { ScraperLogger } from '../../../../../Scrapers/Pipeline/Logging/Debug.js';
import type {
  IElementMediator,
  IRaceResult,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { NOT_FOUND_RESULT } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import { preferDirectEntry } from '../../../../../Scrapers/Pipeline/Mediator/Home/HomeDirectEntry.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Max's revealed private-customers link carries no href at all. */
const NAVIGABLE_HREF = 'https://www.example.co.il/login';

/** Silent logger — assertions carry the diagnostics. */
const SILENT = {
  /**
   * No-op debug.
   * @returns True.
   */
  debug: (): boolean => true,
} as unknown as ScraperLogger;

/** A DOM element the resolver can return, described by what it exposes. */
interface IFakeElement {
  readonly id: string;
  /** Visible text — the element resolves only when a candidate carries it. */
  readonly text: string;
  /** Candidate kind that matches it: accessible name or plain text. */
  readonly kind: SelectorCandidate['kind'];
  /** Empty string models an element with no href attribute at all. */
  readonly href: string;
}

/** Text carried by WK_HOME.ENTRY — the toggle and its same-text wrapper. */
const ENTRY_TEXT = 'כניסה לאיזור האישי';

/** Accessible name carried by WK_HOME.MENU — revealed by the toggle click. */
const MENU_NAME = 'כניסה לאזור אישי - לקוחות פרטיים';

/**
 * The href-less dropdown toggle. It is `<a role="button">` with no aria-label,
 * so ARIA derives its accessible name from its own text — an accessible-name
 * candidate matches it just as readily as the link it reveals.
 */
const TOGGLE: IFakeElement = {
  id: 'personal-entrance',
  text: ENTRY_TEXT,
  kind: 'ariaLabel',
  href: '',
};

/**
 * The login link the toggle reveals. Max's is `<a id="private"
 * class="login-link" aria-label=…>` with NO href — an Angular-driven anchor,
 * so only the accessible name identifies it.
 */
const MENU_LINK: IFakeElement = {
  id: 'private',
  text: MENU_NAME,
  kind: 'ariaLabel',
  href: '',
};

/** A walked-up wrapper sharing the toggle's text — the Max BoG shape. */
const DECOY: IFakeElement = {
  id: 'layout-header',
  text: ENTRY_TEXT,
  kind: 'textContent',
  href: '',
};

/**
 * The production placeholder for an element that carries no DOM id. Real menu
 * toggles frequently have none — Max's is `<a role="button">` with only a class.
 */
const NO_DOM_ID = '(none)';

/** The same toggle as {@link TOGGLE}, but with no usable DOM id. */
const TOGGLE_NO_ID: IFakeElement = {
  id: NO_DOM_ID,
  text: ENTRY_TEXT,
  kind: 'ariaLabel',
  href: '',
};

/**
 * Wrap a fake element as the race result shape the resolver consumes.
 *
 * <p>The identity mirrors what {@link IElementMediator} captures from a live
 * element, not just its id — the preference falls back to those attributes when
 * a control has no usable id.
 * @param element - Element to expose.
 * @returns Race result carrying the element and its matching candidate.
 */
function toRaceResult(element: IFakeElement): IRaceResult {
  const candidate = { kind: element.kind, value: element.text } as SelectorCandidate;
  const identity = {
    tag: 'a',
    id: element.id,
    classes: '',
    name: '',
    type: '',
    ariaLabel: element.text,
    title: '',
    href: element.href,
  } as IRaceResult['identity'];
  return { ...NOT_FOUND_RESULT, found: true as const, value: element.id, candidate, identity };
}

/**
 * Look up a fake element by the race result that carries it.
 * @param visible - Elements the page currently exposes.
 * @param result - Race result to resolve back to an element.
 * @returns The matching element, or the toggle when unknown.
 */
function elementFor(visible: readonly IFakeElement[], result: IRaceResult): IFakeElement {
  const match = visible.find((element: IFakeElement): boolean => element.id === result.value);
  return match ?? TOGGLE;
}

/**
 * Keep only the elements some supplied candidate actually matches. This is what
 * makes the spec depend on WHICH candidates the production code scans: a menu
 * item is unreachable unless a MENU candidate is in the list.
 * @param visible - Elements the page currently exposes, in DOM order.
 * @param candidates - Candidate list the production code supplied.
 * @returns The subset a candidate matches.
 */
function matchedBy(
  visible: readonly IFakeElement[],
  candidates: readonly SelectorCandidate[],
): readonly IFakeElement[] {
  const wanted = new Set(candidates.map((candidate: SelectorCandidate): string => candidate.value));
  return visible.filter((element: IFakeElement): boolean => wanted.has(element.text));
}

/**
 * Build a mediator over a fixed set of visible elements. Attribute reads answer
 * from the element, which is what drives DIRECT vs SEQUENTIAL classification.
 * @param visible - Elements the page currently exposes, in DOM order.
 * @returns Stub element mediator.
 */
function makeMediator(visible: readonly IFakeElement[]): IElementMediator {
  return {
    /**
     * Enumerate the visible elements the supplied candidates match.
     * @param candidates - Candidate list under test.
     * @returns One race result per matched element.
     */
    resolveAllVisible: (
      candidates: readonly SelectorCandidate[],
    ): Promise<readonly IRaceResult[]> => {
      const results = matchedBy(visible, candidates).map(toRaceResult);
      return Promise.resolve(results);
    },
    /**
     * Report whether the element carries an attribute.
     * @param result - Race result under inspection.
     * @param attr - Attribute name.
     * @returns Succeed(true) only for a non-empty href.
     */
    checkAttribute: (result: IRaceResult, attr: string): Promise<unknown> => {
      const element = elementFor(visible, result);
      const has = attr === 'href' && element.href.length > 0;
      const outcome = succeed(has);
      return Promise.resolve(outcome);
    },
    /**
     * Read an attribute value.
     * @param result - Race result under inspection.
     * @returns The element's href, empty when it has none.
     */
    getAttributeValue: (result: IRaceResult): Promise<string> => {
      const element = elementFor(visible, result);
      return Promise.resolve(element.href);
    },
  } as unknown as IElementMediator;
}

/**
 * Run the production preference over a page state.
 * @param visible - Elements the page currently exposes, in DOM order.
 * @param primaryElement - The race winner HOME is reconsidering.
 * @returns The DOM id the preference selected.
 */
async function preferredIdFrom(
  visible: readonly IFakeElement[],
  primaryElement: IFakeElement = TOGGLE,
): Promise<string> {
  const mediator = makeMediator(visible);
  const primary = toRaceResult(primaryElement);
  const chosen = await preferDirectEntry({ mediator, primary, logger: SILENT });
  return chosen.value;
}

describe('HOME entry preference across a revealed menu (T-HOMEMENU)', () => {
  it('T-HOMEMENU-1: keeps the toggle while its menu is still closed', async () => {
    const preferredId = await preferredIdFrom([TOGGLE]);
    expect(preferredId).toBe(TOGGLE.id);
  });

  it('T-HOMEMENU-2: ignores a walked-up wrapper sharing the toggle text', async () => {
    const preferredId = await preferredIdFrom([DECOY, TOGGLE]);
    expect(preferredId).toBe(TOGGLE.id);
  });
  it('T-HOMEMENU-3: prefers the revealed href-less link once the menu is open', async () => {
    const preferredId = await preferredIdFrom([TOGGLE, DECOY, MENU_LINK]);
    expect(preferredId).toBe(MENU_LINK.id);
  });

  it('T-HOMEMENU-4: a navigable href still outranks an accessible name', async () => {
    const navigable: IFakeElement = {
      id: 'account-link',
      text: ENTRY_TEXT,
      kind: 'textContent',
      href: NAVIGABLE_HREF,
    };
    const preferredId = await preferredIdFrom([TOGGLE, MENU_LINK, navigable]);
    expect(preferredId).toBe(navigable.id);
  });

  it('T-HOMEMENU-5 (FIRING): skips an id-less toggle rather than re-clicking it', async () => {
    const visible = [TOGGLE_NO_ID, MENU_LINK];
    const preferredId = await preferredIdFrom(visible, TOGGLE_NO_ID);
    expect(preferredId).toBe(MENU_LINK.id);
  });
});
