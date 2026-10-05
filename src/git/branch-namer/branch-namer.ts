import { SemanticTypeSchema, semanticTypes } from '../semantic-types.js'

export interface BranchSpec {
  type: string
  scope: string
  description?: string
}

/** Builds the conventional `<type>/<scope>[-<description>]` branch name. */
export class BranchNamer {
  name(spec: BranchSpec): string {
    const semanticTypeValidation = SemanticTypeSchema.safeParse(spec.type)
    if (!semanticTypeValidation.success) {
      throw new Error(
        `invalid branch type "${spec.type}" — must be one of: ${semanticTypes.join(', ')}`,
      )
    }
    if (spec.scope.trim() === '') {
      throw new Error('branch scope is required')
    }
    const slug =
      spec.description !== undefined && spec.description !== '' ? `-${spec.description}` : ''
    return `${spec.type}/${spec.scope}${slug}`
  }
}

export const branchNamer = new BranchNamer()
