# Branch Protection Configuration

Protection is managed via a **GitHub Ruleset** (not classic branch protection rules).
View at: Settings > Rules > Rulesets > `main`

## Ruleset: `main`

### Pull Request Rules

- [x] **Require a pull request before merging**
- [x] Approvals: 0 (CI checks are the gatekeepers; Dependabot PRs auto-merge)
- [x] Dismiss stale reviews on push
- [x] Require thread resolution
- [x] Squash merge only

### Required Status Checks (7)

All must pass before merge:

- `Lint & Format` — ESLint (--max-warnings 0) + Prettier + Markdown lint
- `Type Check` — tsc --noEmit (strict mode)
- `Unit Tests` — Jest with coverage thresholds
- `Build Verification` — Full build + output verification
- `npm Audit` — npm audit --audit-level=high (production deps)
- `Validate PR Title` — Conventional commit format
- `E2E Smoke Tests` — Factory + error handling with Chrome

### Branch Rules

- [x] No force push
- [x] No deletion
- [x] Linear history required
- [x] Branch must be up to date before merge

## Security Features

Configure at: Settings > Code security and analysis

- [x] **Dependency graph** — enabled
- [x] **Dependabot alerts** — enabled
- [x] **Dependabot security updates** — enabled
- [x] **Secret scanning** — enabled
- [x] **Push protection** — enabled
- [x] **Private vulnerability reporting** — enabled
- [x] **CodeQL** — via PR Validation workflow

## Environments

### `npm-publish`

Used by the release workflow for npm Trusted Publishing (OIDC).
No required reviewers — publishing is gated by the validate job.

## Secrets

| Secret | Purpose |
|--------|---------|
| `RELEASE_TOKEN` | GitHub PAT for release-please (so PRs trigger CI) |
| `AMEX_ID`, `AMEX_CARD6DIGITS`, `AMEX_PASSWORD` | Amex E2E test credentials |
| `VISACAL_USERNAME`, `VISACAL_PASSWORD` | VisaCal E2E test credentials |
| `DISCOUNT_ID`, `DISCOUNT_PASSWORD`, `DISCOUNT_NUM` | Discount E2E (local only — blocked in CI) |
| npm Trusted Publishing | OIDC — no secret needed |
