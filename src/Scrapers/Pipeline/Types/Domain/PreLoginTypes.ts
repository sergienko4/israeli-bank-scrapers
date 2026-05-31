/**
 * Discovery status returned by PreLogin.PRE for each reveal candidate.
 *   READY    — element found and visible → ACTION fires a normal click.
 *   OBSCURED — element in DOM but not visible (e.g. aria-hidden by UserWay) → ACTION uses force:true.
 *   NOT_FOUND — element absent from DOM → ACTION skips.
 */
type RevealStatus = 'READY' | 'OBSCURED' | 'NOT_FOUND';

/** Reveal action determined by PRE for ACTION to execute. */
type RevealAction = 'CLICK' | 'NAVIGATE' | 'NONE';

/** Resolved element target — PRE discovered, ACTION executes via contextId. */
interface IResolvedTarget {
  /** CSS/XPath selector for the element. */
  readonly selector: string;
  /** Opaque frame identifier — `'main'` or `'iframe:<url>'`. */
  readonly contextId: string;
  /** Strategy that matched (xpath, placeholder, labelText, etc.). */
  readonly kind: string;
  /** Candidate value that was searched for. */
  readonly candidateValue: string;
}

/** PreLogin.PRE discovery report — ACTION reads instead of re-discovering. */
interface IPreLoginDiscovery {
  /** Status of the Business/Private split selector. */
  readonly privateCustomers: RevealStatus;
  /** Status of the credential mode toggle (password vs SMS/OTP). */
  readonly credentialArea: RevealStatus;
  /** What ACTION must do: click, navigate, or nothing. */
  readonly revealAction: RevealAction;
  /** Pre-resolved target for ACTION to click/navigate (contextId + selector). */
  readonly revealTarget?: IResolvedTarget;
}

export type { IPreLoginDiscovery, IResolvedTarget, RevealAction, RevealStatus };
