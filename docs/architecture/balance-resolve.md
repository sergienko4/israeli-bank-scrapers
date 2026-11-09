# Account and card balances

Every API-direct shape emits `balanceResolution` for the final result.
The standalone browser-era balance phase and its state slots are removed.

## Card-issuer balances under the direct-API model

With `BALANCE-RESOLVE` retired for pipeline banks, each shape's `balance` step
owns the figure. For a card issuer the pipeline's account unit is the **card**,
so a balance is only publishable when the provider attributes it to a card.
All four issuers do:

| Bank         | Provider figure                                                                                                                                                       | Attributable to a card? | `balance.extract`        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------ |
| **Max**      | `getHomePageData` → `Result.UserCards.Cards[].CycleSummary[]`, sitting on the same object as `Last4Digits`                                                            | ✅ yes                  | real per-card debit      |
| **Visa Cal** | `GetTotalFrameStatus`, one request per card → `result.calIssuedCards.accountLevelFrames[]`; the frame whose `cardUniqueId` is the card's own carries `nextTotalDebit` | ✅ yes                  | real per-card next debit |
| **Isracard** | GatewayV2 `GetTransactionsList`, one request per card for its next debit month → `data.israelAbroadVouchers.vouchers.totalForStatement.totalIlsBillingDate`           | ✅ yes                  | real per-card next debit |
| **Amex**     | The same Ring-family GatewayV2 `GetTransactionsList` as Isracard, on Amex's ring host                                                                                 | ✅ yes                  | real per-card next debit |

Max's figure rides the card object itself. Reading
it costs **no extra request** — the customer step already fetches
`getHomePageData` to enumerate cards — so the shape keeps `balance.skipFetch:
true` and answers from the account instead of a response body. `skipFetch`
therefore means _"the value is already in hand"_, not _"no value exists"_.

That handoff is why `IApiDirectScrapeShape`'s balance `extract` receives
`(body, acct)`: a skipped fetch yields an empty body, so the account is the
only channel through which a pre-fetched figure can reach the extractor.

| Symbol                                                                                                                                           | Role                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`ilsCycleDebit`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/Max/scrape/MaxShapeBalance.ts) | Selects the ILS row of one card's cycle summary and returns its outstanding debit, degrading to `0` on any unusable shape |
| `MaxCardCycleBalance`                                                                                                                            | Nominal brand for that debit, per the Rule&nbsp;#15 boundary convention every peer bank shape follows                     |
| `IMaxRawCycle`                                                                                                                                   | The slice of a raw Max card entry that carries `CycleSummary`                                                             |
| `IMaxCycleRow`                                                                                                                                   | One per-currency cycle row (`Currency`, `TotalDebitSum`)                                                                  |

`ilsCycleDebit` never throws: a missing summary, a non-array payload, an
absent ILS row or a non-finite figure all degrade to `0`, so a wire-shape
change cannot fail a scrape that has otherwise succeeded. Captures show the
redaction writer can itself replace `Cards` with a string, so the non-array
case is observed in practice rather than defensive.

Visa Cal's figure needs a call of its own. `GetTotalFrameStatus` answers one
card per request with that card's `nextTotalDebit`, the total of its charges
on the next debit date. The frame is matched by `cardUniqueId` only, across
both the CAL-issued and bank-issued groups, and never summed across cards. A
reply CAL confirmed (`statusCode` 1 with a `result`) reports `0` when it has
no frame for the card, or when the card's frames carry no finite
`nextTotalDebit` (missing, a string, `NaN`, infinite): that is CAL's no-data
contract, not a missing balance. Only a reply CAL did not confirm, or one
whose frame structure is malformed (a card group that is present but not an
object, where `null` counts as omitted; a frame list that is not an array; or
a frame without a string `cardUniqueId`),
is declared absent by `balanceIsAbsent`: the card publishes no balance and the
scrape is marked degraded. A failed frames call is masked to `BALANCE_UNKNOWN`
the same way, so the card keeps its transactions rather than reporting a `0`
the bank never sent.

| Symbol                                                                                                                                                      | Role                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`nextTotalDebitOf`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/VisaCal/scrape/VisaCalShapeBalance.ts) | Returns one card's next ILS debit from the frames response, or `0` when a confirmed reply has no frame for the card or no finite figure in its frames                                                       |
| `balanceIsAbsent`                                                                                                                                           | Declares the figure missing only when CAL did not confirm the reply or its frame structure is malformed; an unusable figure in a well-formed frame is `0`, not absence. Consulted before `nextTotalDebitOf` |
| `VisaCalNextDebit`                                                                                                                                          | Nominal brand for that debit (Rule&nbsp;#15)                                                                                                                                                                |
| `balanceVars` / `balanceUrl`                                                                                                                                | The frames request body (one `cardUniqueId`) and its literal URL                                                                                                                                            |

Isracard's figure comes from the transactions endpoint, in one extra request
per card. `balanceVars` asks GatewayV2 `GetTransactionsList` for the card's
next debit month: this month on or before the card's payment day, the next
month after it. That month's statement total is the card's next debit. A
month with no vouchers node reports `0`, since nothing is pending. A card with
no payment day, or vouchers whose total is missing or not a finite number, is
declared absent by `balanceIsAbsent`: the card publishes no balance and the
scrape is marked degraded. A reply the bank did not confirm (`isSuccess` not
`true`) fails its call in the shape's body check, so the balance step's
`fallbackOnFail` publishes no balance either.

| Symbol                                                                                                                                                     | Role                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`nextDebitOf`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Phases/ApiDirectScrape/Ring/RingShapeBalance.ts) | Returns one card's next ILS debit from the statement total, or `0` for a month with no vouchers             |
| `nextDebitMonth`                                                                                                                                           | Picks the card's next debit month from today and its payment day                                            |
| `balanceIsAbsent`                                                                                                                                          | Declares the figure missing when the card has no payment day, or the month has vouchers but no finite total |
| `RingNextDebit`                                                                                                                                            | Nominal brand for that debit (Rule&nbsp;#15)                                                                |
| `balanceVars`                                                                                                                                              | The GatewayV2 request body for the card's next debit month                                                  |
