// The canonical set of semantic (conventional-commit) types. Shared so branch
// names and commit messages draw from one vocabulary, keeping the history
// legible to semantic-release.
export const semanticTypes = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
  'style',
  'revert',
] as const

export type SemanticType = (typeof semanticTypes)[number]

export function isSemanticType(value: string): value is SemanticType {
  return semanticTypes.some((t) => t === value)
}
