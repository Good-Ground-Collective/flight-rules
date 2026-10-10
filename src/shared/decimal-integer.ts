import { InvalidArgumentError } from "commander";

/** Reads whole numbers typed on the command line, accepting decimal digits only: no hex, exponent, sign or blank. */
export class DecimalIntegerParser {
  /** A pull request number or similar count that starts at 1. */
  positive(value: string): number {
    return this.parse(value, /^[1-9][0-9]*$/, "must be a positive whole number written in decimal digits");
  }

  /** A revision, which starts at 0. */
  nonNegative(value: string): number {
    return this.parse(value, /^(0|[1-9][0-9]*)$/, "must be a whole number from 0 written in decimal digits");
  }

  private parse(value: string, pattern: RegExp, message: string): number {
    const parsed = Number(value);
    if (!pattern.test(value) || !Number.isSafeInteger(parsed)) throw new InvalidArgumentError(message);
    return parsed;
  }
}

export const decimalIntegers: DecimalIntegerParser = new DecimalIntegerParser();
