const simpleEscapes: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
};

/** Reads file paths as git prints them in diffs: C-quoted when they hold special characters, and prefixed with `a/` or `b/`. */
export class GitPath {
  /** Decodes a path token, unquoting and unescaping it when git quoted it. */
  static decode(token: string): string {
    if (token.length >= 2 && token.startsWith('"') && token.endsWith('"')) {
      return GitPath.unescape(token.slice(1, -1));
    }
    return token;
  }

  /** Removes the single-letter `a/` or `b/` side prefix git adds to diff paths. */
  static stripSidePrefix(path: string): string {
    return /^[ab]\//.test(path) ? path.slice(2) : path;
  }

  /** Reads the path from a `---` or `+++` line, dropping the tab git appends after unquoted paths. */
  static fromFileMarker(rest: string): string {
    const unquoted = rest.startsWith('"') ? rest : rest.split("\t")[0] ?? rest;
    return GitPath.decode(unquoted);
  }

  /** Reads the new-side path from the arguments of a `diff --git` line. */
  static fromDiffHeader(rest: string): string | undefined {
    if (rest.startsWith('"')) {
      const end = GitPath.closingQuote(rest);
      const remainder = rest.slice(end + 1).trimStart();
      return remainder === "" ? undefined : GitPath.stripSidePrefix(GitPath.decode(remainder));
    }

    const quotedSplit = rest.indexOf(' "b/');
    if (quotedSplit !== -1) {
      return GitPath.stripSidePrefix(GitPath.decode(rest.slice(quotedSplit + 1)));
    }

    const splits: number[] = [];
    for (let at = rest.indexOf(" b/"); at !== -1; at = rest.indexOf(" b/", at + 1)) {
      splits.push(at);
    }
    const symmetric = splits.find((at) => rest.slice(2, at) === rest.slice(at + 3));
    const chosen = symmetric ?? splits[splits.length - 1];
    return chosen === undefined ? undefined : rest.slice(chosen + 3);
  }

  private static closingQuote(text: string): number {
    for (let i = 1; i < text.length; i++) {
      if (text[i] === "\\") {
        i++;
      } else if (text[i] === '"') {
        return i;
      }
    }
    return text.length - 1;
  }

  private static unescape(body: string): string {
    const bytes: number[] = [];

    for (let i = 0; i < body.length; i++) {
      const char = body[i] ?? "";
      const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4));
      const simple = simpleEscapes[body[i + 1] ?? ""];

      if (char !== "\\") {
        bytes.push(...Buffer.from(char, "utf8"));
      } else if (octal) {
        bytes.push(parseInt(octal[0], 8) & 0xff);
        i += octal[0].length;
      } else if (simple !== undefined) {
        bytes.push(simple);
        i++;
      } else {
        bytes.push(92);
      }
    }

    return Buffer.from(bytes).toString("utf8");
  }
}
