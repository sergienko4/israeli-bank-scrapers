/**
 * Workflow-security gate wiring test.
 *
 * <p>`workflow-security.yml` runs `zizmor`, the auditor that actually
 * understands GitHub Actions — including the `$/` self-repository syntax
 * that OpenSSF Scorecard misreports as 28 unpinned third-party actions.
 * zizmor is therefore the repository's authority on workflow hardening,
 * and the Scorecard `PinnedDependenciesID` alerts are dismissed on its
 * word.
 *
 * <p>An authority that cannot fail a build is not an authority, and this job
 * could not: the scan ended in `|| true` with no later step reading the
 * result. Removing `|| true` is necessary but **not sufficient** — zizmor
 * documents that `--format sarif` suppresses its finding exit codes (11+)
 * entirely, so the SARIF invocation returns 0 even with findings. Verified
 * against zizmor 1.30.0 on this repository: SARIF mode exited 0 while plain
 * mode exited 12 on the same tree. A real gate therefore needs a *second*,
 * non-SARIF invocation whose exit code is allowed to stand.
 *
 * <p>This test pins the properties that make the job a gate rather than a
 * decoration, because each can be removed by a well-meaning edit without
 * anything else going red:
 *
 * <ul>
 *   <li>a non-SARIF invocation exists to produce a real exit code;</li>
 *   <li>that invocation does not neutralise itself with `|| true`,
 *       `set +e` or `continue-on-error`;</li>
 *   <li>the SARIF upload still runs when the scan fails, or making it
 *       blocking would cost us the code-scanning history;</li>
 *   <li>zizmor is version-pinned, or the gate's strictness changes
 *       under us without a commit;</li>
 *   <li>the pin is at least the release whose default policy requires
 *       hash-pinning on every action;</li>
 *   <li>the scan still covers composite actions, a blind spot that once
 *       hid two real findings.</li>
 * </ul>
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

const THIS_FILE_PATH = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE_PATH);
const REPO_ROOT = join(THIS_DIR, '../../../../../');
const SECURITY_YAML = join(REPO_ROOT, '.github/workflows/workflow-security.yml');
const SCORECARD_YAML = join(REPO_ROOT, '.github/workflows/scorecard.yml');

/** YAML job key that runs the audit. */
const ZIZMOR_JOB_KEY = 'zizmor';

/**
 * Step output recording that the SARIF file exists and parses. The upload
 * condition must consult it, or a scan that died before writing anything
 * turns into a misleading upload error.
 */
const SARIF_READY_OUTPUT = 'steps.sarif.outputs.is_ready';

/** Step id of the producer that decides whether the SARIF is usable. */
const SARIF_STEP_ID = 'sarif';

/**
 * The only upload guard that is safe. Asserted whole rather than by
 * substring: `|| <ready>` or `== 'false'` both *contain* the readiness
 * output while inverting what it guards. Compared after normalisation, so
 * its spacing here is readability only.
 */
const REQUIRED_UPLOAD_CONDITION = `\${{ !cancelled() && ${SARIF_READY_OUTPUT} == 'true' }}`;

/**
 * First release whose `unpinned-uses` default requires hash-pinning on every
 * action rather than only third-party ones. A pin below this silently relaxes
 * the policy the dismissal of the Scorecard alerts depends on.
 */
const MINIMUM_MAJOR = 1;
const MINIMUM_MINOR = 20;

/** Step-level shape this test reads — everything else is irrelevant. */
interface IWorkflowStep {
  readonly name?: string;
  readonly id?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly if?: string;
  readonly 'continue-on-error'?: boolean | string;
}

interface IWorkflowJob {
  readonly steps?: readonly IWorkflowStep[];
  readonly 'continue-on-error'?: boolean | string;
}

interface IWorkflowDoc {
  readonly jobs?: Readonly<Record<string, IWorkflowJob>>;
}

/**
 * Parse the workflow-security workflow.
 *
 * @returns Parsed workflow document.
 */
function loadWorkflow(): IWorkflowDoc {
  const raw = readFileSync(SECURITY_YAML, 'utf8');
  return parse(raw) as IWorkflowDoc;
}

/**
 * The audit job itself.
 *
 * @returns The zizmor job, or an empty job when it no longer exists.
 */
function auditJob(): IWorkflowJob {
  const doc = loadWorkflow();
  return doc.jobs?.[ZIZMOR_JOB_KEY] ?? {};
}

/**
 * Steps of the audit job.
 *
 * @returns Every step declared by the zizmor job.
 */
function auditSteps(): readonly IWorkflowStep[] {
  const job = auditJob();
  return job.steps ?? [];
}

/**
 * Drop comment-only lines from a `run:` block.
 *
 * <p>Every assertion here is about what the shell executes, not about what
 * the surrounding prose says, and the steps of this job necessarily describe
 * each other — the gate's comment exists to explain why the SARIF run cannot
 * gate. Matching raw text would let a comment edit satisfy an assertion whose
 * subject has been deleted, or point one at the wrong step.
 *
 * @param run - Raw `run:` block.
 * @returns The block's executable lines, comments removed.
 */
function executableLines(run: string): string {
  const lines = run.split('\n');
  const kept = lines.filter(line => !line.trim().startsWith('#'));
  return kept.join('\n');
}

/**
 * Executable content of a step's `run` block.
 *
 * @param step - Step to read.
 * @returns The step's shell commands, comments removed.
 */
function codeOf(step: IWorkflowStep): string {
  return executableLines(step.run ?? '');
}

/**
 * The command the auditor is invoked with.
 *
 * @returns The scan step's shell commands, or an empty string when no step
 *   invokes zizmor in SARIF mode.
 */
function scanRun(): string {
  const steps = auditSteps();
  const step = steps.find(item => {
    const code = codeOf(item);
    return code.includes('zizmor --format sarif');
  });
  return codeOf(step ?? {});
}

/**
 * The command the auditor is installed with.
 *
 * @returns The install step's shell commands, or an empty string when none
 *   installs zizmor.
 */
function installRun(): string {
  const steps = auditSteps();
  const step = steps.find(item => {
    const code = codeOf(item);
    return code.includes('pipx install');
  });
  return codeOf(step ?? {});
}

/**
 * Guard on the step that uploads the audit result to code scanning.
 *
 * @returns The upload step's `if` condition, or an empty string when none
 *   uploads SARIF or the step is unconditional.
 */
function uploadCondition(): string {
  const steps = auditSteps();
  const step = steps.find(item => item.uses?.includes('upload-sarif') === true);
  return step?.if ?? '';
}

/**
 * Normalise a workflow expression for comparison.
 *
 * <p>GitHub treats whitespace between expression tokens as insignificant, so
 * every spacing of the same expression must compare equal — including no
 * spacing at all, which a collapse-to-one-space rule would miss.
 *
 * <p>This would corrupt a string literal containing spaces. The compared
 * condition's only literal is `'true'`, and adding one with a space would be
 * a semantic change that has to update the assertion anyway.
 *
 * @param expression - Raw `if` expression.
 * @returns The expression with all whitespace removed.
 */
function normaliseExpression(expression: string): string {
  return expression.replace(/\s+/g, '');
}

/**
 * Upload guard with insignificant whitespace removed, so only a meaningful
 * change to the expression can break the comparison.
 *
 * @returns The normalised `if` condition, or an empty string when absent.
 */
function normalisedUploadCondition(): string {
  const condition = uploadCondition();
  return normaliseExpression(condition);
}

/**
 * The step that decides whether a usable SARIF exists.
 *
 * @returns Its shell commands, or an empty string when the step is gone.
 */
function producerRun(): string {
  const steps = auditSteps();
  const step = steps.find(item => item.id === SARIF_STEP_ID);
  return codeOf(step ?? {});
}

/** Everything the readiness producer must actually do to be trustworthy. */
const PRODUCER_REQUIREMENTS = [
  { label: 'checks the report is non-empty', fragment: '-s zizmor.sarif' },
  { label: 'proves the bytes parse as JSON', fragment: 'json.load' },
  { label: 'records a usable report', fragment: 'is_ready=true' },
  { label: 'records an unusable report', fragment: 'is_ready=false' },
] as const;

/**
 * Spacings GitHub parses identically. A reformat of the guard changes none
 * of its meaning, so none of these may fail WSG-11.
 */
const EQUIVALENT_SPACINGS = [
  { label: 'canonical', expression: REQUIRED_UPLOAD_CONDITION },
  {
    label: 'no spaces between tokens',
    expression: `\${{!cancelled()&&${SARIF_READY_OUTPUT}=='true'}}`,
  },
  {
    label: 'padded',
    expression: `\${{   !cancelled()   &&   ${SARIF_READY_OUTPUT}  ==  'true'   }}`,
  },
  {
    label: 'wrapped onto two lines',
    expression: `\${{ !cancelled()\n  && ${SARIF_READY_OUTPUT} == 'true' }}`,
  },
] as const;

/** Synthetic `run` blocks proving gate detection reads code, not prose. */
const GATE_DETECTION_CASES = [
  {
    label: 'a plain-format invocation',
    run: 'zizmor --format plain .github/workflows',
    isGate: true,
  },
  { label: 'the installer', run: 'pipx install zizmor==1.30.0', isGate: false },
  { label: 'the SARIF invocation', run: 'zizmor --format sarif . > zizmor.sarif', isGate: false },
  {
    label: 'a step that only mentions zizmor in prose',
    run: '# see the zizmor gate below\nnpm ci',
    isGate: false,
  },
  {
    label: 'a gate whose comment quotes --format sarif',
    run: '# the run above uses --format sarif, which exits 0\nzizmor --format plain .github/workflows',
    isGate: true,
  },
  {
    label: 'a gate whose comment quotes pipx install',
    run: '# installed above with pipx install zizmor==1.30.0\nzizmor --format plain .github/workflows',
    isGate: true,
  },
  {
    label: 'a step that only reads the SARIF file by name',
    run: "if [ -s zizmor.sarif ] && python3 -c 'import json'; then\n  echo ok\nfi",
    isGate: false,
  },
] as const;

/**
 * Does a `run` block invoke zizmor in a mode that yields a finding exit code?
 *
 * <p>Matched on executable lines that *start* a zizmor command, not on any
 * mention of the string. The steps in this job necessarily discuss each other
 * and one of them reads `zizmor.sarif` by name, so looser matching would both
 * read prose as code and mistake a file reference for an invocation.
 *
 * @param run - Raw `run:` block.
 * @returns True for a non-SARIF zizmor invocation, excluding the installer.
 */
function isGateCommand(run: string): boolean {
  const code = executableLines(run);
  const lines = code.split('\n');
  const invocations = lines.filter(line => line.trim().startsWith('zizmor '));
  const hasSarifMode = invocations.some(line => line.includes('--format sarif'));
  return invocations.length > 0 && !hasSarifMode;
}

/**
 * Every step whose exit code could fail the job.
 *
 * @returns All non-SARIF zizmor invocations, in declaration order.
 */
function gateCandidates(): readonly IWorkflowStep[] {
  const steps = auditSteps();
  return steps.filter(item => isGateCommand(item.run ?? ''));
}

/**
 * The step whose exit code is allowed to fail the job.
 *
 * @returns The gate step, or an empty step when none exists yet.
 */
function gateStep(): IWorkflowStep {
  const candidates = gateCandidates();
  return candidates[0] ?? {};
}

/**
 * The gate step's shell commands.
 *
 * @returns Executable content of the gate, or an empty string when absent.
 */
function gateRun(): string {
  const step = gateStep();
  return codeOf(step);
}

/**
 * Is a pinned `major.minor` at least the minimum the policy depends on?
 *
 * @param major - Parsed major version.
 * @param minor - Parsed minor version.
 * @returns True when the pin is at or above the minimum.
 */
function isAtLeastMinimum(major: number, minor: number): boolean {
  const isNewerMajor = major > MINIMUM_MAJOR;
  const isSameMajor = major === MINIMUM_MAJOR;
  return isNewerMajor || (isSameMajor && minor >= MINIMUM_MINOR);
}

/** Ways a `run` block can quietly discard its own failure. */
const EXIT_CODE_ESCAPES = ['|| true', '|| exit 0', 'set +e', '--no-exit-codes'] as const;

/**
 * Both scopes GitHub Actions accepts `continue-on-error` at. Either one
 * restores advisory behaviour, and neither lives inside a `run` block.
 */
const TOLERANCE_SCOPES = [
  { scope: 'the gate step', isTolerated: gateStep()['continue-on-error'] },
  { scope: 'the zizmor job', isTolerated: auditJob()['continue-on-error'] },
] as const;

describe('workflow-security zizmor gate', () => {
  it('[WSG-1] the audit job exists and invokes zizmor', () => {
    const run = scanRun();
    expect(run).toContain('zizmor');
  });

  /**
   * The defect this suite was written for, and the one that survived the
   * first attempt at fixing it. `--format sarif` suppresses zizmor's finding
   * exit codes, so the SARIF run reports 0 no matter what it finds. Without a
   * second, non-SARIF invocation the job cannot fail on a finding at all.
   *
   * <p>Exactly one, because the assertions below identify the gate as "the
   * non-SARIF zizmor call". A second one added ahead of it would make them
   * validate the wrong step, letting the real gate quietly regain `|| true`
   * with every test still green.
   */
  it('[WSG-2] exactly one non-SARIF invocation exists to produce a real exit code', () => {
    const candidates = gateCandidates();
    expect(candidates).toHaveLength(1);
  });

  it.each(EXIT_CODE_ESCAPES)('[WSG-3] the gate does not neutralise itself with %s', escapeHatch => {
    const executable = gateRun();
    expect(executable).not.toContain(escapeHatch);
  });

  /**
   * `continue-on-error` lives outside the `run` block, so the string
   * assertions above cannot see it. It is the cheapest way to silently
   * restore the old advisory behaviour — and GitHub Actions accepts it at
   * job level too, where it makes the whole job non-blocking no matter how
   * the gate step itself is written.
   */
  it.each(TOLERANCE_SCOPES)('[WSG-4] $scope is not marked continue-on-error', ({ isTolerated }) => {
    expect(isTolerated).toBeUndefined();
  });

  /**
   * Making the scan blocking is only safe if the SARIF still reaches code
   * scanning on a failing run — otherwise the first real finding also
   * destroys the record of what it was. `!cancelled()` rather than
   * `always()`: a cancelled run leaves a truncated `zizmor.sarif`, and
   * uploading it fails confusingly on a run nobody is waiting for.
   */
  it('[WSG-5] SARIF is uploaded when the scan fails but not when cancelled', () => {
    const condition = uploadCondition();
    expect(condition).toContain('!cancelled()');
  });

  /**
   * `!cancelled()` deliberately ignores `success()`, so the upload also runs
   * when an earlier step failed — including a failure *before* the redirect
   * produced anything. `> zizmor.sarif` truncates on open, so that leaves an
   * empty file, and uploading it fails with a parse error that buries the
   * real cause. The condition must therefore also require a usable file.
   */
  it('[WSG-11] the upload is guarded on a SARIF having actually been produced', () => {
    const condition = normalisedUploadCondition();
    const required = normaliseExpression(REQUIRED_UPLOAD_CONDITION);
    expect(condition).toBe(required);
  });

  /**
   * WSG-11 only proves the condition *names* the readiness output. If the
   * step producing it were deleted, the reference would silently resolve to
   * empty, the upload would never run, and the gate would still be green —
   * the failure mode the guard exists to prevent, reintroduced invisibly.
   */
  it.each(PRODUCER_REQUIREMENTS)('[WSG-12] the readiness producer $label', ({ fragment }) => {
    const run = producerRun();
    expect(run).toContain(fragment);
  });

  /**
   * WSG-11 compares the guard whole, which is only fair if the comparison
   * ignores what GitHub ignores. Otherwise a purely cosmetic reformat fails
   * a security test, and the next person learns to edit the assertion
   * rather than read it.
   */
  it.each(EQUIVALENT_SPACINGS)('[WSG-13] $label spacing compares equal', ({ expression }) => {
    const [canonical] = EQUIVALENT_SPACINGS;
    const expected = normaliseExpression(canonical.expression);
    const actual = normaliseExpression(expression);
    expect(actual).toBe(expected);
  });

  it('[WSG-6] the auditor is version-pinned', () => {
    const run = installRun();
    expect(run).toContain('zizmor==');
  });

  it('[WSG-7] the pin is parseable and at or above the minimum', () => {
    const run = installRun();
    const match = /zizmor==(\d+)\.(\d+)\./.exec(run);
    expect(match).not.toBeNull();
    const major = Number(match?.[1]);
    const minor = Number(match?.[2]);
    const isAccepted = isAtLeastMinimum(major, minor);
    expect(isAccepted).toBe(true);
  });

  /**
   * A pin below v1.20.0 reverts `unpinned-uses` to allowing ref-pinned
   * first-party actions, quietly weakening the policy that justifies
   * dismissing the Scorecard alerts. zizmor shipped a long `0.x` line, so a
   * downgrade to `0.30.0` is a plausible edit and must not read as newer.
   */
  it.each([
    { major: 0, minor: 30, isAccepted: false },
    { major: 1, minor: 19, isAccepted: false },
    { major: 1, minor: 20, isAccepted: true },
    { major: 2, minor: 0, isAccepted: true },
  ])('[WSG-8] $major.$minor is accepted: $isAccepted', ({ major, minor, isAccepted }) => {
    const isActual = isAtLeastMinimum(major, minor);
    expect(isActual).toBe(isAccepted);
  });

  /**
   * Gate detection is what points every assertion above at the right step, so
   * it must read executable content rather than prose. The steps in this job
   * necessarily describe each other, and a step excluded by its own comment
   * while another is included by its comment would leave exactly one
   * candidate — the wrong one — with the whole suite still green.
   */
  it.each(GATE_DETECTION_CASES)('[WSG-10] $label is a gate: $isGate', ({ run, isGate }) => {
    const isDetected = isGateCommand(run);
    expect(isDetected).toBe(isGate);
  });

  /**
   * Composite actions were once outside the scan, which hid two real
   * `self-repository` findings until a manual run surfaced them. Asserted on
   * the gate as well as the SARIF run: dropping the path from the gate alone
   * would keep reporting composite-action findings while no longer blocking
   * on them.
   */
  it.each([
    { label: 'SARIF run', run: scanRun() },
    { label: 'gate', run: gateRun() },
  ])('[WSG-9] the $label covers composite actions, not only workflows', ({ run }) => {
    expect(run).toContain('.github/actions');
  });
});

/** Trigger and root-level shape of the Scorecard workflow. */
interface IScorecardDoc {
  readonly on?: Readonly<Record<string, unknown>>;
  readonly env?: unknown;
  readonly defaults?: unknown;
  readonly jobs?: Readonly<Record<string, IWorkflowJob>>;
}

/**
 * Parse the Scorecard workflow.
 *
 * @returns Parsed workflow document.
 */
function loadScorecard(): IScorecardDoc {
  const raw = readFileSync(SCORECARD_YAML, 'utf8');
  return parse(raw) as IScorecardDoc;
}

/** The job key that runs the Scorecard analysis. */
const SCORECARD_JOB_KEY = 'analysis';

/** The action that produces `results.sarif`. */
const SCORECARD_ACTION = 'ossf/scorecard-action';

/** The action that uploads SARIF to code scanning. */
const UPLOAD_SARIF_ACTION = 'github/codeql-action/upload-sarif';

/** The script that strips `$/` self-repository false positives from the SARIF. */
const SARIF_FILTER_SCRIPT = 'scripts/filter-scorecard-sarif.mjs';

/**
 * Steps of the Scorecard analysis job.
 *
 * @returns Every step declared by the analysis job.
 */
function scorecardSteps(): readonly IWorkflowStep[] {
  const doc = loadScorecard();
  const job = doc.jobs?.[SCORECARD_JOB_KEY] ?? {};
  return job.steps ?? [];
}

/**
 * Index of the first step whose `run` block invokes the SARIF filter.
 *
 * @returns Its position in the analysis job, or -1 when absent.
 */
function filterStepIndex(): number {
  const steps = scorecardSteps();
  return steps.findIndex(step => (step.run ?? '').includes(SARIF_FILTER_SCRIPT));
}

/**
 * Index of the first step whose `uses` matches an action fragment.
 *
 * @param fragment - Substring identifying the action.
 * @returns Its position in the analysis job, or -1 when absent.
 */
function scorecardStepIndex(fragment: string): number {
  const steps = scorecardSteps();
  return steps.findIndex(step => step.uses?.includes(fragment) === true);
}

describe('scorecard workflow triggers', () => {
  /**
   * The scan was cron-only, so a vulnerability fixed on a Tuesday stayed
   * reported as "high" until the following Monday. That is exactly what
   * happened to the two browserslist advisories in alert 63: fixed in
   * `9ebcbc7`, still open days later with no way to ask for a re-scan.
   */
  it('[SCD-1] the scan can be triggered on demand', () => {
    const triggers = Object.keys(loadScorecard().on ?? {});
    expect(triggers).toContain('workflow_dispatch');
  });

  it('[SCD-2] the weekly schedule is retained alongside it', () => {
    const triggers = Object.keys(loadScorecard().on ?? {});
    expect(triggers).toContain('schedule');
  });

  /**
   * The `ossf/scorecard-action` signature verifier rejects any workflow
   * carrying root-level `env:` or `defaults:` with "workflow contains global
   * env vars or defaults". The failure names the verifier rather than the
   * edit that caused it, so it is worth catching here instead.
   */
  it('[SCD-3] no workflow-root env or defaults, which the signature verifier rejects', () => {
    const doc = loadScorecard();
    const hasForbiddenRoot = doc.env !== undefined || doc.defaults !== undefined;
    expect(hasForbiddenRoot).toBe(false);
  });
});

describe('scorecard SARIF false-positive filter', () => {
  /**
   * Scorecard v2.4.4 cannot parse GitHub's `$/` self-repository syntax and
   * reports every `uses: $/…` reference as an unpinned third-party action —
   * 28 false `PinnedDependenciesID` alerts on this repo. Rather than revert
   * the syntax (which zizmor's `self-repository` audit requires and which
   * GitHub treats as pinning), `scripts/filter-scorecard-sarif.mjs` strips
   * only those false positives from the SARIF before upload. Both scanners
   * end up satisfied. See docs/workflow/code-scanning.md, upstream
   * https://github.com/ossf/scorecard/issues/5191.
   */
  it('[SCF-1] the analysis job filters the SARIF before uploading it', () => {
    const index = filterStepIndex();
    expect(index).toBeGreaterThanOrEqual(0);
  });

  /**
   * The filter can only remove what Scorecard has already written, so it must
   * run after the action that produces `results.sarif`.
   *
   * <p>The producer is asserted present before the ordering is compared.
   * `scorecardStepIndex` returns -1 for a missing step, so deleting the
   * Scorecard action would otherwise leave `filterAt > -1` trivially true and
   * this case would keep passing while asserting nothing.
   */
  it('[SCF-2] the filter runs after Scorecard produces the SARIF', () => {
    const filterAt = filterStepIndex();
    const produceAt = scorecardStepIndex(SCORECARD_ACTION);
    expect(produceAt).toBeGreaterThanOrEqual(0);
    expect(filterAt).toBeGreaterThan(produceAt);
  });

  /**
   * If the upload ran first the false positives would reach code scanning
   * anyway, so the filter must run before the SARIF is uploaded.
   *
   * <p>Both endpoints are asserted present first. `scorecardStepIndex` returns
   * -1 for a missing step, so an ordering comparison alone can be satisfied by
   * the sentinel rather than by real ordering, leaving the case silently
   * unchecked.
   */
  it('[SCF-3] the filter runs before the SARIF reaches code scanning', () => {
    const filterAt = filterStepIndex();
    const uploadAt = scorecardStepIndex(UPLOAD_SARIF_ACTION);
    expect(filterAt).toBeGreaterThanOrEqual(0);
    expect(uploadAt).toBeGreaterThanOrEqual(0);
    expect(filterAt).toBeLessThan(uploadAt);
  });
});
