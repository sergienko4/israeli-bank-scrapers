# Branch Protection Configuration

These settings must be configured manually in GitHub repository settings.

## Settings > Branches > Add rule

### Branch name pattern: `main`

- [x] **Require a pull request before merging**
  - [x] Require approvals: 1
  - [x] Dismiss stale pull request approvals when new commits are pushed

- [x] **Require status checks to pass before merging**
  - [x] Require branches to be up to date before merging
  - Required status checks:
    - `Lint & Format`
    - `Type Check`
    - `Unit Tests`
    - `Build Verification`
    - `CodeQL Security Scan`
    - `Dependency Review`
    - `npm Audit`
    - `Validate PR Title`
    - `E2E Tests`

- [x] **Require signed commits** (recommended)

- [x] **Do not allow bypassing the above settings**

- [x] **Restrict force pushes**

- [x] **Restrict deletions**

## Settings > Code security and analysis

- [x] **Dependency graph** - Enable
- [x] **Dependabot alerts** - Enable
- [x] **Dependabot security updates** - Enable
- [x] **Secret scanning** - Enable
- [x] **Push protection** - Enable
- [x] **Code scanning** - Enabled via CodeQL workflow

## Settings > Environments (optional)

Create an environment named `npm-publish`:

- [x] Required reviewers: add yourself
- [x] Allow administrators to bypass for emergency releases
