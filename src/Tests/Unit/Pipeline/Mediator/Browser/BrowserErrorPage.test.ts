/**
 * Unit tests for BrowserErrorPage — Firefox neterror title detection.
 *
 * <p>Pins the matcher used by INIT.POST + LOGIN.PRE so additions to
 * the title patterns don't regress existing detections.
 */

import probeFirefoxNeterror from '../../../../../Scrapers/Pipeline/Mediator/Browser/BrowserErrorPage.js';

/** Page-like stub with a scripted `title()` response. */
interface ITitleStub {
  readonly title: () => Promise<string>;
}

/**
 * Build a Page-like stub that returns a scripted title.
 *
 * @param scripted - Title to return, or `'__throws__'` to reject.
 * @returns Page-like stub.
 */
function stub(scripted: string): ITitleStub {
  return {
    /**
     * Scripted title implementation — resolves with `scripted` or
     * rejects when the sentinel `'__throws__'` is passed.
     *
     * @returns Promise resolving to the scripted title, or rejected.
     */
    title: (): Promise<string> => {
      if (scripted === '__throws__') {
        const stubError = new TypeError('title-eval-fail');
        return Promise.reject(stubError);
      }
      return Promise.resolve(scripted);
    },
  };
}

interface IPositiveCase {
  readonly label: string;
  readonly title: string;
}

const POSITIVE_CASES: readonly IPositiveCase[] = [
  { label: 'NETERROR-001 — Firefox <100 DNS failure', title: 'Server Not Found' },
  {
    label: 'NETERROR-002 — Firefox 100+ DNS failure',
    title: "Hmm. We're having trouble finding that site.",
  },
  { label: 'NETERROR-003 — TCP refused', title: 'Unable to connect' },
  { label: 'NETERROR-004 — TLS / network timeout', title: 'Connection timed out' },
  {
    label: 'NETERROR-005 — connection variant',
    title: 'Did Not Connect: Potential Security Issue',
  },
  { label: 'NETERROR-006 — generic fallback', title: 'Problem loading page' },
  { label: 'NETERROR-007 — case-insensitive', title: 'SERVER NOT FOUND' },
];

interface INegativeCase {
  readonly label: string;
  readonly title: string;
}

const NEGATIVE_CASES: readonly INegativeCase[] = [
  { label: 'POSITIVE-001 — Hebrew bank title', title: 'בנק דיסקונט - דף בית' },
  { label: 'POSITIVE-002 — English bank title', title: 'Discount Bank Login' },
  { label: 'POSITIVE-003 — empty title (probe failed)', title: '' },
  { label: 'POSITIVE-004 — generic SPA title', title: 'Login | Bank Hapoalim' },
];

describe('probeFirefoxNeterror — Firefox/Camoufox neterror title detection', () => {
  for (const c of POSITIVE_CASES) {
    it(`${c.label}: detects neterror title`, async () => {
      const page = stub(c.title);
      const probe = await probeFirefoxNeterror(page);
      expect(probe.isNeterror).toBe(true);
      expect(probe.title).toBe(c.title);
    });
  }

  for (const c of NEGATIVE_CASES) {
    it(`${c.label}: not a neterror title`, async () => {
      const page = stub(c.title);
      const probe = await probeFirefoxNeterror(page);
      expect(probe.isNeterror).toBe(false);
    });
  }

  it('NETERROR-PROBE-FAIL: returns isNeterror=false when title() rejects (observability-only, fail open)', async () => {
    const page = stub('__throws__');
    const probe = await probeFirefoxNeterror(page);
    expect(probe.isNeterror).toBe(false);
    expect(probe.title).toBe('');
  });
});
