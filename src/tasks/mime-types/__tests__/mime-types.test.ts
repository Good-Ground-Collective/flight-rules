import { describe, it, expect } from 'vitest'
import { ExtensionMimeTypeResolver } from '../mime-types.js'

const resolver = new ExtensionMimeTypeResolver()

describe('ExtensionMimeTypeResolver', () => {
  it('maps each known extension to its MIME type', () => {
    expect(resolver.forFilename('before.png')).toBe('image/png')
    expect(resolver.forFilename('shot.jpg')).toBe('image/jpeg')
    expect(resolver.forFilename('shot.jpeg')).toBe('image/jpeg')
    expect(resolver.forFilename('anim.gif')).toBe('image/gif')
    expect(resolver.forFilename('pic.webp')).toBe('image/webp')
    expect(resolver.forFilename('icon.svg')).toBe('image/svg+xml')
    expect(resolver.forFilename('clip.webm')).toBe('video/webm')
    expect(resolver.forFilename('clip.mp4')).toBe('video/mp4')
    expect(resolver.forFilename('clip.mov')).toBe('video/quicktime')
  })

  it('resolves the extension case-insensitively', () => {
    expect(resolver.forFilename('clip.MOV')).toBe('video/quicktime')
    expect(resolver.forFilename('BEFORE.PNG')).toBe('image/png')
  })

  it('falls back to application/octet-stream for unknown or missing extensions', () => {
    expect(resolver.forFilename('notes.txt')).toBe('application/octet-stream')
    expect(resolver.forFilename('README')).toBe('application/octet-stream')
  })
})
