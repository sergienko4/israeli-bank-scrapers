# Adding a new bank

Every bank uses `API-DIRECT-CALL` followed by `API-DIRECT-SCRAPE`. Add
declarative HTTP configuration and a hard-model shape, never a browser
launcher, DOM login configuration or navigation phase.

## Register the bank

1. Add its `CompanyTypes` and `SCRAPERS` metadata in `src/Definitions.ts`.
   Declare the credential fields the bank actually accepts.
2. Capture the bank's authentication and collection HTTP exchanges using
   an authorized account. Redact credentials, tokens and financial data
   before storing fixtures.
3. Add the login steps and explicit transport configuration under
   `src/Scrapers/Pipeline/Registry/Config/`. Use `nativeFetch` for ordinary
   HTTP or the client-certificate/TLS-profile transport when required.
   Missing or conflicting transport selections fail closed.
4. Add the account, balance and transaction shape under
   `src/Scrapers/Pipeline/Banks/<Name>/`. Reuse shared extraction,
   pagination, cookie-session and bank-calendar helpers.
5. Assemble the descriptor with `withOptions` and
   `withApiDirect(loginConfig, shape)`. See
   [LeumiPipeline.ts](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Leumi/LeumiPipeline.ts)
   for the actual builder contract.
6. Register the factory in `Banks/PipelineRegistryAmexToMax.ts` or
   `Banks/PipelineRegistryMercantileToVisaCal.ts`. Core remains bank-agnostic.
7. Declare additional authentication hosts in
   `Registry/Config/PipelineBankHosts.ts` when needed by CI's DNS preflight.
   List only hosts the bank actually uses.

## Authentication and OTP

Use the shared API-direct login configuration, including OTP steps and
durable-auth hooks when supported. Do not rerun an entire failed phase:
authentication can have side effects such as issuing a new SMS.
See [API-DIRECT-CALL](../phases/api-direct-call.md) for its contracts and
build-time checks.

## Tests and review

Add focused unit tests for new transforms and boundary failures, and a
mocked HTTP flow under `src/Tests/E2eMocked/`. Use the shared fetch-mock
helpers so a malformed request fails offline. Include expected accounts,
balances, transactions, error classification and redaction behavior.

Run only the relevant tests needed for the change locally. Normal hooks
run the local quality gates; CI owns the complete suites. Live-bank tests
require explicit authorization and the appropriate approval gate.
See [Test surfaces](testing.md).
