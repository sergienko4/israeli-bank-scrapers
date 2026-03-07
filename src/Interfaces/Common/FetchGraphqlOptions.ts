/** Scalar GraphQL variable value — no null/undefined, nested objects allowed. */
type GraphQlVarScalar = string | number | boolean;

/** Nested object supported in GraphQL variables (e.g. pagination input types). */
type GraphQlVarObject = Record<string, GraphQlVarScalar>;

export interface IFetchGraphqlOptions {
  variables?: Record<string, GraphQlVarScalar | GraphQlVarObject>;
  extraHeaders?: Record<string, string>;
}
