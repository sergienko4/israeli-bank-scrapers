/**
 * Canary — closes spec.txt §1 RC-1 (`js/clear-text-logging`).
 *
 * <p>Verifies the T09d selector in `eslint.config.mjs`
 * (RESTRICTED_SYNTAX_RULES + RESTRICTED_SYNTAX_RULES_NEW) catches
 * interpolation of sensitive scraper-error-enum members (e.g.
 * `ScraperErrorTypes.InvalidPassword`,
 * `LOGIN_RESULTS.ChangePassword`) into a logger template literal.
 *
 * <p>Applicable guidelines (per spec.txt §1 RC-1):
 * <ul>
 *   <li>`logging-pii-guidlines.md` §1 — "NEVER log: passwords,
 *       API keys, ... raw PII." Sensitive enum tags are
 *       password-class metadata.</li>
 *   <li>`testing-organization-guidlines.md` — "Use clear test
 *       names describing behavior and expected outcome."</li>
 * </ul>
 */

/** Stub object whose property names match the T09d selector regex. */
const ScraperErrorTypes = {
  InvalidPassword: 'InvalidPassword',
  ChangePassword: 'ChangePassword',
} as const;

/** Stub logger surface — matches the `bankLog` / `LOG` shape. */
const bankLog = {
  info: (line: string): boolean => Boolean(line),
};

/**
 * Deliberate violation — the T09d selector fires on
 * a `ScraperErrorTypes.InvalidPassword` member-expression
 * interpolated into a template literal passed to `bankLog.info`.
 * @returns Always true so the function has a meaningful return type.
 */
function leakSensitiveEnum(): boolean {
  return bankLog.info(`errorType=${ScraperErrorTypes.InvalidPassword}`);
}

export { leakSensitiveEnum };
