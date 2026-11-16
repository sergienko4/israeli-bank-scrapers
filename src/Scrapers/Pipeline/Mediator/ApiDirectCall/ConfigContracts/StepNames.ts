/**
 * A login step name. The contract is open: a bank may declare any name whose
 * shape the builder rules accept, without editing this file. The soft brand
 * keeps the name distinct in signatures while still accepting config literals;
 * the builder validates the shape at registration.
 */

/** A login step name, validated at registration. */
type StepName = string & { readonly __stepName?: 'StepName' };

export type { StepName };
