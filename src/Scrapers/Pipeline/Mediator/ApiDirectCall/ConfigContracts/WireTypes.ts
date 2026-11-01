/**
 * WireTypes — the answer-reading concern slice of the API-DIRECT-CALL config
 * contract: what a step captures from a `text` answer (N36 text captures,
 * N37 login-form capture).
 *
 * A root bucket: no intra-cluster deps. FlowTypes references these from
 * `IStepBase`.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

/**
 * One text capture (N36) on a `text` step: its pattern must match the answer
 * exactly once, and the slot takes the text of `group`. An `absent` capture is
 * a guard instead: its pattern must not match, and it carries nothing.
 */
interface ITextCapture {
  /** Regex source, searched in the whole answer with the `g` flag. */
  readonly pattern: string;
  /** Group whose text the slot takes; 0 is the whole match. */
  readonly group: number;
  /** Makes the capture a guard: the pattern must not match. */
  readonly absent?: true;
}

/**
 * A login-form capture (N37) on a `text` step: the page's one `<form>` whose
 * `id` or `name` is `form` must post to `action`, and its hidden fields go to
 * carry `into` as one `{ name: value }` record, in page order.
 */
interface IFormCapture {
  /** The form's `id` or `name`, compared exactly. */
  readonly form: string;
  /** Carry slot the field record goes to. */
  readonly into: string;
  /** Absolute URL the form's action must resolve to, against the step URL. */
  readonly action: string;
  /** Field names the form must hold. */
  readonly required: readonly string[];
  /** Field names the form must not hold. */
  readonly forbidden: readonly string[];
  /** Fewest fields the form may hold. */
  readonly minFields: number;
  /** Most fields the form may hold. */
  readonly maxFields: number;
}

export type { IFormCapture, ITextCapture };
