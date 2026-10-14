import { Command } from 'commander'
import { DocIdSchema, InvalidDocIdError } from '../../doc-resolver/doc-resolver.js'
import type { DocResolver } from '../../doc-resolver/doc-resolver.js'
import { LaunchOperationAccessPolicy, OperationRegistry } from '../../../operations/operation-registry.js'
import { DocOperation } from '../../../operations/doc-operation.js'

export function createDocCommand(getResolver: () => DocResolver): Command {
  const doc = new Command('doc')
  const operation = new DocOperation({ getResolver })
  const registry = new OperationRegistry({
    operations: [operation],
    policy: new LaunchOperationAccessPolicy({ allowedEffects: ['read'] }),
  })
  doc.exitOverride()
    .argument('<id>', 'doc id, the basename of a file in docs/ without .md')
    .option('--path', 'print the absolute path instead of the contents')
    .action(async (id: string, opts: { path?: boolean }) => {
      if (!DocIdSchema.safeParse(id).success) {
        throw new InvalidDocIdError('Invalid doc id — use lowercase letters, digits, and single hyphens')
      }

      const result = await registry.invoke(operation.id, { id })
      if (result.status !== 'success') {
        const error = result.error
        throw new Error(`${error.name}: ${error.message}`)
      }
      const output = operation.outputSchema.parse(result.data)
      process.stdout.write(opts.path ? `${output.path}\n` : output.contents.endsWith('\n') ? output.contents : `${output.contents}\n`)
    })
  return doc
}
