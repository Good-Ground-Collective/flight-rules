import { Command } from 'commander'
import { DocIdSchema, InvalidDocIdError } from '../../doc-resolver/doc-resolver.js'
import type { DocResolver } from '../../doc-resolver/doc-resolver.js'

export function createDocCommand(getResolver: () => DocResolver): Command {
  const doc = new Command('doc')
  doc.exitOverride()
    .argument('<id>', 'doc id, the basename of a file in docs/ without .md')
    .option('--path', 'print the absolute path instead of the contents')
    .action((id: string, opts: { path?: boolean }) => {
      if (!DocIdSchema.safeParse(id).success) {
        throw new InvalidDocIdError('Invalid doc id — use lowercase letters, digits, and single hyphens')
      }

      const resolved = getResolver().resolve(id)
      process.stdout.write(opts.path ? `${resolved.path}\n` : resolved.contents.endsWith('\n') ? resolved.contents : `${resolved.contents}\n`)
    })
  return doc
}
