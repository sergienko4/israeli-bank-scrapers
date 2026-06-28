import type { IFormAnchor } from '../../Mediator/Form/Anchor/AnchorTypes.js';
import type { Option } from '../Option.js';
import type { IResolvedTarget } from './PreLoginTypes.js';

/** LOGIN field keys — compiler-enforced, no raw strings. */
const LOGIN_FIELDS = {
  PASSWORD: 'password',
  USERNAME: 'username',
  ID: 'id',
  CARD6: 'card6Digits',
  NUM: 'num',
  USER_CODE: 'userCode',
} as const;

/** Union of valid LOGIN field keys. */
type LoginFieldKey = (typeof LOGIN_FIELDS)[keyof typeof LOGIN_FIELDS];

/** LOGIN phase discovery — resolved field targets from PRE. */
interface ILoginFieldDiscovery {
  /** Pre-resolved field targets keyed by LoginFieldKey. */
  readonly targets: ReadonlyMap<LoginFieldKey, IResolvedTarget>;
  /** Form anchor discovered from password field. */
  readonly formAnchor: Option<IFormAnchor>;
  /** Opaque identifier of the frame where fields were found. */
  readonly activeFrameId: string;
  /** Pre-resolved submit button target (contextId + selector). */
  readonly submitTarget: Option<IResolvedTarget>;
}

/**
 * Stable fail-code string for the login-not-completed failure — the single
 * source of truth shared by LOGIN.FINAL's completion enforcer (the emitter)
 * and the pipeline reducer (which matches it to keep that one honest failure
 * non-retryable; a perpetually-spinning login never settles, so one try is
 * enough on a stuck login screen).
 */
const LOGIN_NOT_COMPLETED_CODE = 'LOGIN_NOT_COMPLETED' as const;

export { LOGIN_FIELDS, LOGIN_NOT_COMPLETED_CODE };
export type { ILoginFieldDiscovery, LoginFieldKey };
