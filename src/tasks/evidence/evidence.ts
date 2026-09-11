import { basename } from 'node:path/posix'
import { z } from 'zod'
import type { Attachment, TaskTracker } from '../task-tracker/task-tracker.js'

/** A markdown image or link — `![alt](target)` or `[text](target)` — with an optional bang and title. */
const mediaReference = /(!?)\[([^\]]*)\]\(\s*<?([^\s()<>]+)>?(?:\s+"[^"]*")?\s*\)/g

/** A URL scheme (`https:`, already-`attachment:`), a protocol-relative `//`, or an in-page `#` anchor — never a local file to rewrite. */
const absoluteTarget = /^[a-zA-Z][a-zA-Z0-9+.-]*:|^\/\/|^#/
const localPrefix = /^(?:\.\/)+/

/** Up to three leading spaces, then a run of three or more backticks or tildes, then the rest of the line. */
const fenceRun = /^ {0,3}(`{3,}|~{3,})(.*)$/

/** The delimiter character and length of an open code fence, so its close can be matched per CommonMark. */
interface OpenFence {
  char: string
  length: number
}

/**
 * `<path>#<caption>`, where the caption is used only when the file is appended
 * (an in-body reference keeps its own alt text). `#` is legal in a filename, so
 * a leading or absent `#` means the whole spec is the path and the caption falls
 * back to the basename.
 */
export const AttachmentSpecSchema = z.string().min(1).transform((spec) => {
  const hash = spec.lastIndexOf('#')
  const path = hash > 0 ? spec.slice(0, hash) : spec
  const caption = hash > 0 ? spec.slice(hash + 1).trim() : ''
  return { path, caption: caption.length > 0 ? caption : basename(path) }
})

export type AttachmentSpec = z.infer<typeof AttachmentSpecSchema>

export interface EvidenceRequest {
  ticketId: string
  body: string
  specs: readonly string[]
}

export interface EvidenceAttachment extends Attachment {
  path: string
  caption: string
  referenced: boolean
}

export interface AttachedEvidence {
  body: string
  attachments: EvidenceAttachment[]
}

export interface EvidenceService {
  attach(input: EvidenceRequest): Promise<AttachedEvidence>
}

export interface DuplicateEvidenceNameProps {
  filename: string
  paths: readonly string[]
}

/** Two specs whose files share a basename would collide on the same `attachment:<filename>` marker, so the rewrite could not tell them apart. */
export class DuplicateEvidenceNameError extends Error {
  override name = 'DuplicateEvidenceNameError'

  constructor(props: DuplicateEvidenceNameProps) {
    super(`Two attachments share the filename "${props.filename}": ${props.paths.join(', ')}`)
  }
}

export interface TrackerEvidenceServiceProps {
  tracker: TaskTracker
}

/**
 * Uploads every `--attach` spec, then rewrites the body's local `![alt](./file)`
 * and `[text](./file)` references to `attachment:<filename>` and appends any
 * unreferenced file. Uploads finish before the body is rewritten, so a body
 * never ships with a marker for a file that failed to upload — unlike gh's
 * partial-post behaviour, which the PR host keeps because gh owns its own rewrite.
 */
export class TrackerEvidenceService implements EvidenceService {
  private readonly tracker: TaskTracker

  constructor(props: TrackerEvidenceServiceProps) {
    this.tracker = props.tracker
  }

  async attach(input: EvidenceRequest): Promise<AttachedEvidence> {
    const specs = input.specs.map((spec) => AttachmentSpecSchema.parse(spec))
    this.rejectDuplicateNames(specs)

    const attachments = await Promise.all(
      specs.map(async (spec) => {
        const uploaded = await this.tracker.addAttachment(input.ticketId, spec.path)
        return { ...uploaded, path: spec.path, caption: spec.caption, referenced: false }
      }),
    )

    const byName = new Map<string, EvidenceAttachment>()
    for (const attachment of attachments) byName.set(basename(attachment.path), attachment)

    const rewritten = this.rewriteReferences(input.body, byName)
    return { body: this.appendUnreferenced(rewritten, attachments), attachments }
  }

  private rejectDuplicateNames(specs: readonly AttachmentSpec[]): void {
    const paths = new Map<string, string[]>()
    for (const spec of specs) {
      const name = basename(spec.path)
      paths.set(name, [...(paths.get(name) ?? []), spec.path])
    }

    for (const [filename, group] of paths) {
      if (group.length > 1) throw new DuplicateEvidenceNameError({ filename, paths: group })
    }
  }

  private rewriteReferences(body: string, byName: Map<string, EvidenceAttachment>): string {
    let fence: OpenFence | undefined

    return body
      .split('\n')
      .map((line) => {
        if (fence === undefined) {
          const opened = this.openingFence(line)
          if (opened !== undefined) {
            fence = opened
            return line
          }
          return this.rewriteLine(line, byName)
        }
        if (this.closesFence(line, fence)) fence = undefined
        return line
      })
      .join('\n')
  }

  /**
   * A line opens a fence when it is a run of >=3 backticks or tildes; a backtick
   * fence's info string may not itself contain a backtick, which keeps inline
   * code from being read as a fence.
   */
  private openingFence(line: string): OpenFence | undefined {
    const match = fenceRun.exec(line)
    if (match === null) return undefined
    const run = match[1]
    const rest = match[2]
    if (run === undefined || rest === undefined) return undefined
    if (run.charAt(0) === '`' && rest.includes('`')) return undefined
    return { char: run.charAt(0), length: run.length }
  }

  /**
   * A line closes an open fence only when it is a run of the SAME character, at
   * least as long as the opening run, with nothing but whitespace after it.
   */
  private closesFence(line: string, fence: OpenFence): boolean {
    const match = fenceRun.exec(line)
    if (match === null) return false
    const run = match[1]
    const rest = match[2]
    if (run === undefined || rest === undefined) return false
    return run.charAt(0) === fence.char && run.length >= fence.length && rest.trim().length === 0
  }

  private rewriteLine(line: string, byName: Map<string, EvidenceAttachment>): string {
    let result = ''
    let last = 0

    mediaReference.lastIndex = 0
    for (let match = mediaReference.exec(line); match !== null; match = mediaReference.exec(line)) {
      const whole = match[0]
      const bang = match[1]
      const label = match[2]
      const target = match[3]
      result += line.slice(last, match.index)

      const attachment =
        bang !== undefined && label !== undefined && target !== undefined ? this.resolve(target, byName) : undefined
      if (attachment === undefined || bang === undefined || label === undefined) {
        result += whole
      } else {
        attachment.referenced = true
        result += `${bang}[${label}](attachment:${attachment.filename})`
      }

      last = match.index + whole.length
    }

    return result + line.slice(last)
  }

  private resolve(target: string, byName: Map<string, EvidenceAttachment>): EvidenceAttachment | undefined {
    if (absoluteTarget.test(target)) return undefined
    return byName.get(basename(target.replace(localPrefix, '')))
  }

  private appendUnreferenced(body: string, attachments: readonly EvidenceAttachment[]): string {
    let result = body
    for (const attachment of attachments) {
      if (!attachment.referenced) result += `\n\n![${attachment.caption}](attachment:${attachment.filename})`
    }
    return result
  }
}
