/**
 * Commander option-processor that accumulates a repeatable `--flag <value>`
 * into an array instead of overwriting the previous value.
 */
// eslint-disable-next-line preflight/no-loose-functions -- collect is module-level behaviour awaiting a home on a service; tracked in KAN-39
export function collect(value: string, previous: string[]): string[] {
  return [...previous, value]
}
