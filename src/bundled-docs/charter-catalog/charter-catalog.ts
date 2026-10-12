import { matchesGlob } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import type { DocResolver, ResolvedDoc } from '../doc-resolver/doc-resolver.js'

const coreCharterId = 'coding-charter'
const languageCharterPrefix = `${coreCharterId}-`

const LanguageFrontmatterSchema = z
  .strictObject({
    language: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    'applies-to': z.array(z.string().min(1)).min(1),
  })
  .transform(({ language, 'applies-to': appliesTo }) => ({ language, appliesTo }))

const FrontmatterSchema = z
  .string()
  .transform((contents, ctx) => {
    const block = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(contents)?.[1]
    if (block === undefined) {
      ctx.addIssue({ code: 'custom', message: 'missing YAML frontmatter' })
      return z.NEVER
    }
    return parseYaml(block)
  })
  .pipe(LanguageFrontmatterSchema)

/** One charter document: the always-applicable core (`language: null`) or a language charter scoped by globs. */
export interface Charter {
  id: string
  language: string | null
  appliesTo: string[]
  /** Tier A mandate IDs from the charter's Review tiers section, in table order. */
  tierA: string[]
  path: string
  contents: string
}

/** Selects the coding charters that govern a set of repository-relative paths. */
export interface CharterCatalog {
  /** The core charter followed by every language charter, sorted by id. */
  all(): Charter[]
  /** The core charter followed by each language charter whose globs match at least one path. */
  select(paths: readonly string[]): Charter[]
}

export interface DocCharterCatalogProps {
  docs: DocResolver
}

/** Reads charters from bundled docs: `coding-charter` is the core, `coding-charter-<language>` a language charter. */
export class DocCharterCatalog implements CharterCatalog {
  private readonly docs: DocResolver

  constructor(props: DocCharterCatalogProps) {
    this.docs = props.docs
  }

  all(): Charter[] {
    const core = this.docs.resolve(coreCharterId)
    const languages = this.docs
      .list()
      .filter(id => id.startsWith(languageCharterPrefix))
      .map(id => this.languageCharter(this.docs.resolve(id)))

    return [
      { id: core.id, language: null, appliesTo: [], tierA: this.tierA(core.contents), path: core.path, contents: core.contents },
      ...languages,
    ]
  }

  select(paths: readonly string[]): Charter[] {
    const normalized = paths.map(path => path.trim().replace(/^\.\//, '')).filter(path => path.length > 0)
    return this.all().filter(
      charter =>
        charter.language === null ||
        normalized.some(path => charter.appliesTo.some(glob => matchesGlob(path, glob))),
    )
  }

  private languageCharter(doc: ResolvedDoc): Charter {
    const parsed = FrontmatterSchema.safeParse(doc.contents)
    if (!parsed.success) {
      throw new CharterFormatError(`Charter "${doc.id}" has invalid frontmatter: ${z.prettifyError(parsed.error)}`)
    }

    const expectedId = `${languageCharterPrefix}${parsed.data.language}`
    if (doc.id !== expectedId) {
      throw new CharterFormatError(`Charter "${doc.id}" declares language "${parsed.data.language}"; its file must be ${expectedId}.md`)
    }

    return { id: doc.id, ...parsed.data, tierA: this.tierA(doc.contents), path: doc.path, contents: doc.contents }
  }

  private tierA(contents: string): string[] {
    const tiers = contents.split(/^## Review tiers$/m)[1]?.split(/^## /m)[0] ?? ''
    const table = tiers.split(/^\*\*Tier B/m)[0] ?? ''
    return [...new Set([...table.matchAll(/^\|\s*([A-Z]+-\d+)\b/gm)].flatMap(match => match[1] ?? []))]
  }
}

export class CharterFormatError extends Error {
  override name = 'CharterFormatError'
}
