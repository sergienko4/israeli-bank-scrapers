Contributing to @sergienko4/israeli-bank-scrapers
========

Hey people, first of all, thanks for taking the time to help improving this project :beers:

This project needs the help of other developers, since it's impossible getting access to all relevant banks and credit cards.

# How can I contribute?

Any kind of help is welcome, even if you just discover an issue and don't have the time to invest in helping to fix it.

## Filing issues

While there's no specific template for creating a new issue, please take the time to create a clear description so that it is easy to understand the problem.

## Testing the scrapers

In order to run tests you need first to create test configuration file `./src/Tests/.tests-config.cjs` from template `./src/Tests/.tests-config.tpl.cjs`. This file will be used by `jest` testing framework.

> IMPORTANT: Under `src/Tests` folder exists `.gitignore` file that ignore the test configuration file thus this file will not be commited to github. Still when you create new PRs make sure that you didn't explicitly added it to the PR.

This library supports both testing against credit card companies / banks api and also against mock data. Until we will have a good coverage of scrapers test with mock data, the default configuration is set to execute real companies api tests.

### Changing tests options

Modify property `options` in the test configuration file. This object is passed as-is to the scraper.

### Testing specific companies

Enable any company you wish to test by providing its credetials in the test configuration file under `credentials` property.

### Running tests from CLI

> Before running any tests, make sure you created the test configuration file with relevant credentials,

To run all tests of companies that you provided credentials to:

```bash
npm test
```

To run specific `describe` (a.k.a suite), use the `testNamePattern` arg with the name of the suite. The following will run the all tests under the `Factory` suite.

```bash
npm test -- --testNamePattern="Factory"
```

To run specific `test`, use the `testNamePattern` arg with the test name (or the full `describe` name followed by the test name), for example:

```bash
npm test -- --testNamePattern="throws for a company id that was removed from the registry"
```

### Running tests using IDE

Many IDEs support running jest tests directly from the UI. In webstorm for example a small play icon automatically appears next to each describe/test.

**IMPORTANT Note** The project uses ESM (`"type": "module"`). If your IDE needs special configuration for Jest with ESM, set `NODE_OPTIONS=--experimental-vm-modules` in the test run configuration.

### Save unit test scraper results into file

To save unit test scraper results provide a valid path in test configurations property `excelFilesDist`, for example:

```json
{
   "companyAPI": {
      "enabled": true,
      "excelFilesDist": "/Users/xyz/Downloads/Transactions"
   }
}
```

### F.A.Q regarding the tests

#### How can I run tests with CI/CD services?

You can use environment variables instead of a local file to provide the tests configuration.

Copy and adjust the json below with relevant credentials and assign it to environment variable named `TESTS_CONFIG`. Note that this must be a valid json string otherwise it will fail during json parsing.

```json
{
  "options": {
    "startDate": "2019-06-01",
    "combineInstallments": false,
    "showBrowser": true,
    "verbose": false,
    "args": []
  },
  "credentials": {
    "leumi": { "username": "demouser", "password": "demopassword" }
  },
  "companyAPI": {
    "enabled": true,
    "invalidPassword": false
  }
}
```

If you wish to try it from cli (mac os), you should either create a one liner json configuration or use cat to provide multiline value:

```bash
TESTS_CONFIG=$(cat <<EOF
{
  ... replace with actual json configuration ...
}
EOF
) npm run test
```

#### Trying to run the tests using the CLI fail saying the test configuration file is missing
Make sure that you created test configuration file `./src/Tests/.tests-config.cjs` from template `./src/Tests/.tests-config.tpl.cjs`.

#### Trying to run the tests using the IDE fail saying the test configuration file is missing
1. Make sure that you created test configuration file `./src/Tests/.tests-config.cjs` from template `./src/Tests/.tests-config.tpl.cjs`.
2. Make sure that you set `NODE_OPTIONS=--experimental-vm-modules` in the IDE test configuration.

#### Tests of desired company are skipped without any errors

Make sure that you uncommented the company credentials in the test configuration file.

#### Tests that are done against the credit cards companies / banks api are skipped without any errors

1. Make sure that you uncommented the company credentials in the test configuration file.
2. Enable credit card companies / banks api tests in configuration file `companyAPI.enabled: true`

## Submitting PRs

**Pull requests are accepted only from branches in this repository.** A PR opened from a fork is commented on and closed automatically by `.github/workflows/no-fork-prs.yml`. This is not a judgement on the change: CI gates on real-bank end-to-end runs that require repository secrets, and GitHub never exposes secrets to a cross-repository PR, so a fork PR can never reach a green state and can never be merged on the evidence this project requires.

If you do not have write access, please open an issue describing the change and the reasoning behind it. For a bug fix, the diff pasted into the issue is enough to act on, and you will be credited in the resulting commit.

PR titles **must** follow [Conventional Commits](https://www.conventionalcommits.org/) format:

- `fix: description` — bug fix (patch release)
- `feat: description` — new feature (minor release)
- `refactor: description` — code change (no release)
- `docs: description` — documentation only
- `test: description` — test changes only

All PRs must pass CI checks before merge (lint, type-check, tests, build, E2E, audit, PR title validation). The pre-commit hook runs the same 8-gate validation locally.

## Publishing

Publishing is fully automated via CI/CD:

1. Merge PRs with conventional commit titles to `main`
2. `release-please` automatically creates a Release PR (bumps version + CHANGELOG)
3. Merge the Release PR to publish to npm automatically

No manual `npm publish` is needed.

## Creating a new scraper

Every bank is a Pipeline bank: a declarative `PipelineDescriptor` under
`src/Scrapers/Pipeline/Banks/<Name>/`, registered in `PIPELINE_REGISTRY`. There are no
base classes to extend. Start from an existing bank in that folder and follow
[Adding a new bank](https://sergienko4.github.io/israeli-bank-scrapers/contributing/new-bank/).

Whatever the transport, a scrape must return `IScraperScrapingResult` (see
[Interface.ts](./src/Scrapers/Base/Interface.ts)).
