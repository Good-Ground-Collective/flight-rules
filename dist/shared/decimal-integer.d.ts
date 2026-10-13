/** Reads whole numbers typed on the command line, accepting decimal digits only: no hex, exponent, sign or blank. */
export declare class DecimalIntegerParser {
    /** A pull request number or similar count that starts at 1. */
    positive(value: string): number;
    /** A revision, which starts at 0. */
    nonNegative(value: string): number;
    private parse;
}
export declare const decimalIntegers: DecimalIntegerParser;
