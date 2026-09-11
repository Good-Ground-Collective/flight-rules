import { extname } from 'node:path'

const mimeTypesByExtension: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  png: 'image/png',
  svg: 'image/svg+xml',
  webm: 'video/webm',
  webp: 'image/webp',
}
const fallbackMimeType = 'application/octet-stream'

export interface MimeTypeResolver {
  forFilename(filename: string): string
}

/**
 * Evidence uploads carry the screenshot and recording formats the QA lane
 * captures; anything else is handed to Jira as opaque bytes.
 */
export class ExtensionMimeTypeResolver implements MimeTypeResolver {
  forFilename(filename: string): string {
    const extension = extname(filename).slice(1).toLowerCase()
    return mimeTypesByExtension[extension] ?? fallbackMimeType
  }
}

export const extensionMimeTypeResolver: MimeTypeResolver = new ExtensionMimeTypeResolver()
