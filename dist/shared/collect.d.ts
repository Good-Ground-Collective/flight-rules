/**
 * Commander option-processor that accumulates a repeatable `--flag <value>`
 * into an array instead of overwriting the previous value.
 */
export declare function collect(value: string, previous: string[]): string[];
