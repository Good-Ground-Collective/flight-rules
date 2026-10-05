export interface LocalReference {
  line: number
  match: string
}

export interface PortableContextGuard {
  find(body: string): LocalReference[]
  assertPortable(body: string, opts?: { allowLocalPaths?: boolean | undefined }): void
}

/**
 * A reference must start a token to count, so a URL path such as
 * `https://example.com/home/docs` is not mistaken for a home directory.
 */
const tokenStart = String.raw`(?:^|(?<=[\s(\[<{"'\x60=,:;|]))`

const localReferencePatterns: readonly RegExp[] = [
  /file:\/\/\S*/g,
  new RegExp(`${tokenStart}/(?:Users|home)/[^\\s/)\\]>"'\\x60]+\\S*`, 'g'),
  new RegExp(`${tokenStart}~/\\S*`, 'g'),
  /\b[A-Za-z]:\\Users\\\S*/g,
]

/** Prose and markdown that hug a path (a closing backtick, bracket, or full stop) are not part of it. */
const trailingPunctuation = /[`.,;:!?)\]>"']+$/

const maxReported = 5

/**
 * Rejects tracker bodies that point at files on the author's machine. A ticket is
 * the source of truth for whoever picks it up on another machine, so every
 * reference in it must resolve from a fresh clone or a URL
 * (docs/layered-body-format.md, "Portable context").
 */
export class RegexPortableContextGuard implements PortableContextGuard {
  find(body: string): LocalReference[] {
    return body.split('\n').flatMap((text, index) =>
      localReferencePatterns.flatMap((pattern) =>
        [...text.matchAll(pattern)].map((m) => ({ line: index + 1, match: m[0].replace(trailingPunctuation, '') })),
      ),
    )
  }

  assertPortable(body: string, opts: { allowLocalPaths?: boolean | undefined } = {}): void {
    if (opts.allowLocalPaths === true) return
    const found = this.find(body)
    if (found.length === 0) return
    const listed = found
      .slice(0, maxReported)
      .map((ref) => `  line ${ref.line}: ${ref.match}`)
      .join('\n')
    const more = found.length > maxReported ? `\n  …and ${found.length - maxReported} more` : ''
    throw new Error(
      `body references files on this machine, which nobody else can open:\n${listed}${more}\n` +
        'A tracker body must stand on its own for an engineer on a fresh clone. Inline the content, ' +
        'link a published artifact (`flight-rules tdd create`, a tracker issue, or a file on the default ' +
        'branch by URL), or use a repo-relative path for code that exists on the default branch. ' +
        'Pass --allow-local-paths only when the path is the subject of the work, not a pointer to context.',
    )
  }
}

export const portableContextGuard: PortableContextGuard = new RegexPortableContextGuard()
