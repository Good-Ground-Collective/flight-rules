import { text } from 'node:stream/consumers'
import { Command } from 'commander'
import type { CharterCatalog } from '../../charter-catalog/charter-catalog.js'
import type { RepositoryPaths } from '../../charter-catalog/repository-paths.js'

interface CharterOptions {
  stdin?: boolean
  diff?: string
  repo?: boolean
  path?: boolean
}

/**
 * Prints the core coding charter plus every language charter governing the selected files.
 * Applicable language charters accompany the core automatically.
 */
export function createCharterCommand(
  getCatalog: () => CharterCatalog,
  getPaths: () => RepositoryPaths,
  readStdin: () => Promise<string> = () => text(process.stdin),
): Command {
  const charter = new Command('charter')
  charter
    .exitOverride()
    .description('print the core coding charter and the language charters for a set of files')
    .argument('[paths...]', 'repository-relative files to select charters for')
    .option('--stdin', 'read newline-separated paths from stdin')
    .option('--diff <base>', 'select for files changed since the merge base with <base>, including uncommitted work')
    .option('--repo', 'select for every file in the repository (the default)')
    .option('--path', 'print absolute paths, one per line, instead of the contents')
    .action(async (paths: string[], opts: CharterOptions) => {
      const sources = [paths.length > 0, opts.stdin === true, opts.diff !== undefined, opts.repo === true]
      if (sources.filter(Boolean).length > 1) {
        throw new CharterSelectionError('Choose one of: paths, --stdin, --diff <base>, --repo')
      }

      let selection = paths
      if (opts.stdin) selection = (await readStdin()).split('\n')
      else if (opts.diff !== undefined) selection = await getPaths().changedSince(opts.diff)
      else if (paths.length === 0) selection = await getPaths().inventory()

      const selected = getCatalog().select(selection)
      if (selected.every(item => item.language === null)) {
        process.stderr.write('No language charter matched these files; printing the core charter only.\n')
      }

      const output = opts.path
        ? selected.map(item => `${item.path}\n`)
        : selected.map(item => (item.contents.endsWith('\n') ? item.contents : `${item.contents}\n`))
      process.stdout.write(output.join(opts.path ? '' : '\n'))
    })
  return charter
}

export class CharterSelectionError extends Error {
  override name = 'CharterSelectionError'
}
