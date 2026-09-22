import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const DocIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const FileDocResolverPropsSchema = z.object({ docsDir: z.string().min(1) })
const InstallDocsPropsSchema = z.object({
  moduleUrl: z.url().refine(value => value.startsWith('file:')),
  env: z.record(z.string(), z.string().optional()),
})
const DocNotFoundPropsSchema = z.object({ id: z.string(), available: z.array(z.string()) })

export interface ResolvedDoc { id: string; path: string; contents: string }
export interface DocResolver {
  list(): string[]
  resolve(id: string): ResolvedDoc
}
export type FileDocResolverProps = z.infer<typeof FileDocResolverPropsSchema>
export interface InstallDocsProps { moduleUrl: string; env: NodeJS.ProcessEnv }

export class InvalidDocIdError extends Error {
  override name = 'InvalidDocIdError'
}

export class DocNotFoundError extends Error {
  override name = 'DocNotFoundError'
  readonly available: string[]

  constructor(props: z.infer<typeof DocNotFoundPropsSchema>) {
    const parsed = DocNotFoundPropsSchema.parse(props)
    super(`Unknown doc "${parsed.id}" — available: ${parsed.available.join(', ')}`)
    this.available = parsed.available
  }
}

/** Resolves on-disk documentation beside the installed CLI, independent of the caller's cwd. */
export class FileDocResolver implements DocResolver {
  private readonly docsDir: string

  constructor(props: FileDocResolverProps) {
    this.docsDir = resolve(FileDocResolverPropsSchema.parse(props).docsDir)
  }

  list(): string[] {
    return readdirSync(this.docsDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => entry.name.slice(0, -3))
      .sort()
  }

  resolve(id: string): ResolvedDoc {
    if (!DocIdSchema.safeParse(id).success) {
      throw new InvalidDocIdError('Invalid doc id — use lowercase letters, digits, and single hyphens')
    }

    const path = join(this.docsDir, `${id}.md`)
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new DocNotFoundError({ id, available: this.list() })
    }

    const realPath = realpathSync(path)
    if (!realPath.startsWith(`${realpathSync(this.docsDir)}${sep}`)) {
      throw new DocNotFoundError({ id, available: this.list() })
    }

    return { id, path: realPath, contents: readFileSync(realPath, 'utf8') }
  }

  static fromInstall(props: InstallDocsProps): FileDocResolver {
    const { moduleUrl, env } = InstallDocsPropsSchema.parse({ ...props, env: { ...props.env } })
    const override = env['FLIGHT_RULES_HOME']?.trim()
    const home = override || join(dirname(fileURLToPath(moduleUrl)), '..')
    const docsDir = resolve(home, 'docs')

    if (!existsSync(docsDir) || !statSync(docsDir).isDirectory()) {
      const source = override ? `FLIGHT_RULES_HOME is set to ${override} but` : 'Bundled docs directory'
      throw new Error(`${source} ${docsDir} does not exist or is not a directory — point FLIGHT_RULES_HOME at the flight-rules install root`)
    }

    return new FileDocResolver({ docsDir })
  }
}
