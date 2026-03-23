// Canary: Global RESTRICTED_SYNTAX_RULES_NEW — tests MethodDefinition-level rules
// Each section must trigger at least 1 ESLint error.

export class CanaryGlobal {
  public _data!: string; // 🚫 TYPE SKIP: Non-null assertion

  // Return Value Integrity (MethodDefinition — updated from TSMethodDefinition)
  public getNull(): null {
    return null;
  } // 🚫 null return + literal null
  public getVoid(): void {} // 🚫 void return forbidden
  public getUndefined(): undefined {
    return undefined;
  } // 🚫 undefined return

  // Nested call
  public run(): number {
    return Math.abs(Math.floor(1.5));
  } // 🚫 FORBIDDEN NESTED CALL

  // Unknown params/return + unknown variable
  public process(input: unknown): unknown {
    // 🚫 unknown param + return
    const data: unknown = input; // 🚫 unknown variable
    return data;
  }

  // Procedure discard
  public test(): boolean {
    this.record(); // 🚫 PROCEDURE: discarded result
    return true;
  }

  // Short alias
  public rename({ original: o }: { original: string }): string {
    return o;
  } // 🚫 OBFUSCATION

  private record(): { isSuccess: boolean } {
    return { isSuccess: true };
  }
}

// ForInStatement
for (const key in { a: 1 }) {
  String(key);
} // 🚫 ForInStatement banned

// Anti-sleep
const sleepResult = sleep(1000); // 🚫 sleep forbidden
const delayResult = delay(500); // 🚫 delay forbidden
export { sleepResult, delayResult };

declare function sleep(ms: number): Promise<boolean>;
declare function delay(ms: number): Promise<boolean>;
