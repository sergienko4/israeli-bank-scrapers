# JSON algebra — one declaration site, two distinct concepts

> **Who this is for:** anyone typing a value that arrives from `JSON.parse`, a
> captured response body, or a bank's API — i.e. every extraction and
> redaction module in the Pipeline.

[`src/Scrapers/Pipeline/Types/JsonValue.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Types/JsonValue.ts)
is the **single declaration site** for every JSON type in the Pipeline. No
other module may declare one; an architecture test enforces that.

## The two concepts

A JSON value plays two genuinely different roles, and conflating them is what
caused the original divergence.

| Concept | Meaning | Use it when |
|---|---|---|
| **closed** | Recursively a JSON document. Every nested value is itself a `JsonValue`. | You have *validated* the shape, or you must narrow it exhaustively. |
| **open** | The outer container is known; the contents are not yet checked. | The value came from `JSON.parse`, a captured response body, or a type-guard parameter. |

## The symbols

| Symbol | Definition | Arm |
|---|---|---|
| `JsonScalar` | `string \| number \| boolean \| null` | closed |
| `IJsonObject` | `{ readonly [key: string]: JsonValue }` | closed |
| `JsonArray` | `readonly JsonValue[]` | closed |
| `JsonValue` | `JsonScalar \| IJsonObject \| JsonArray` | closed |
| `JsonObject` | alias of `IJsonObject`, for call-sites that read better without the `I` | closed |
| `JsonUnknown` | one un-narrowed value at a boundary | open |
| `JsonUnknownRecord` | `Record<string, JsonUnknown>` | open |
| `JsonUnknownList` | `readonly JsonUnknown[]` | open |

## Why not a single wide type

The obvious consolidation — point everything at one permissive `JsonValue` —
does not compile, and the reason is instructive.

[`Types/PiiRedactor/JsonBody.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Types/PiiRedactor/JsonBody.ts)
walks a body and narrows **exhaustively**: object → array → therefore scalar.
That final "therefore" is only sound over a *closed* union. Widen `JsonValue`
to admit `unknown` and the walker loses its exhaustiveness, so redaction can no
longer prove it visited every node — the one guarantee it exists to provide.

But the extraction boundaries genuinely do receive unchecked input. Fusing both
meanings under one name means every signature that says "this is JSON" silently
also accepts "this is anything". That is precisely why four modules quietly
re-declared the algebra locally in the first place.

So the two concepts stay distinct, are each declared once, and both derive from
the same algebra.

## Choosing an arm

Take `JsonUnknown` at the boundary, validate, and only then hold a closed type:

```ts
function isRecord(v: JsonUnknown): v is JsonUnknownRecord { … }   // ✅ open → open
function isJsonObject(v: JsonValue): v is IJsonObject { … }       // ✅ closed → closed
function isRecord(v: JsonUnknown): v is IJsonObject { … }         // ❌ unsound
```

The third promises that **every nested value** is a `JsonValue`, but a container
check cannot establish that: `{ data: [undefined] }` satisfies it and smuggles
`undefined` into code typed to receive closed JSON. A guard may only return a
closed arm when its input was already closed, or after recursive validation.

## Enforcement

[`src/Tests/Unit/Pipeline/Architecture/JsonValueSingleSource.test.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Tests/Unit/Pipeline/Architecture/JsonValueSingleSource.test.ts)
parses every Pipeline source with the TypeScript compiler API and fails when:

1. any module other than the canonical one declares an algebra member, or
2. a type predicate accepts an open arm and asserts a closed one.

Detection is AST-based rather than line-based deliberately. A regex is bypassed
by ordinary TypeScript a reviewer would never flag — `type JsonValue<T> = …`,
`declare type …`, `export default interface …`, or a declaration nested in a
namespace — and it *fires* on the same text inside a block comment. Walking the
parse tree removes both failure modes.

## History

The algebra was consolidated in v8.6.10. Seven modules had been carrying their
own copy: four declared the full algebra, and three more declared a `JsonObject`
that shared the canonical **name** but meant `Record<string, unknown>` — a
weaker type wearing a stronger name. Structural typing reconciled all seven at
every boundary, so `tsc`, ESLint and the knowledge graph stayed silent.
