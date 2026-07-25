import { z } from "zod"

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

export const SemanticTypeSchema = z.enum(semanticTypes)

export type SemanticType = z.infer<typeof SemanticTypeSchema>


