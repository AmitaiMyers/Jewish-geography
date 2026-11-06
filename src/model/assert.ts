/** Fail fast: throw with a clear message when an invariant is broken. */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invariant violated: ${message}`);
  }
}

/** Return a value that must exist, failing loudly when it does not. */
export function required<T>(value: T | undefined | null, what: string): T {
  assert(value !== undefined && value !== null, `${what} is missing`);
  return value;
}

export function newId(): string {
  return crypto.randomUUID();
}
