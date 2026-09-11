import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

const upload = vi.hoisted(() => vi.fn())
const locationFor = vi.hoisted(() => vi.fn())
vi.mock('../jira-client.js', () => ({
  JiraClient: class {
    upload = upload
    locationFor = locationFor
  },
}))
vi.mock('node:fs', () => ({ readFileSync: vi.fn() }))

import { JiraTaskTracker } from '../jira-task-tracker.js'

const makeTracker = () =>
  new JiraTaskTracker({ token: 'tok', host: 'acme.atlassian.net', email: 'me@acme.com', project: 'PROJ' })

const mediaLocation = (uuid: string) => `https://media.example.com/file/${uuid}/binary?token=abc`

describe('JiraTaskTracker.addAttachment', () => {
  beforeEach(() => {
    upload.mockReset()
    locationFor.mockReset()
    vi.mocked(readFileSync).mockReturnValue(Buffer.from('png-bytes'))
  })

  it('uploads the file, resolves the media UUID from the redirect, and maps a domain Attachment', async () => {
    upload.mockResolvedValue([{ id: 10001, filename: 'before.png', mimeType: 'image/png', size: 9 }])
    locationFor.mockResolvedValue(mediaLocation('12345678-1234-1234-1234-123456789abc'))

    const attachment = await makeTracker().addAttachment('PROJ-2', '/tmp/before.png')

    expect(attachment).toEqual({
      id: '10001',
      filename: 'before.png',
      mimeType: 'image/png',
      size: 9,
      mediaUuid: '12345678-1234-1234-1234-123456789abc',
    })

    const [uploadPath, files] = upload.mock.calls[0] as [string, File[]]
    expect(uploadPath).toBe('/issue/PROJ-2/attachments')
    const [file] = files
    expect(file?.name).toBe('before.png')
    expect(file?.type).toBe('image/png')
    await expect(file?.text()).resolves.toBe('png-bytes')

    expect(locationFor).toHaveBeenCalledWith('/attachment/content/10001')
  })

  it('types the uploaded File by extension via the MIME resolver', async () => {
    upload.mockResolvedValue([{ id: '20002', filename: 'clip.MOV', mimeType: 'video/quicktime' }])
    locationFor.mockResolvedValue(mediaLocation('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'))

    await makeTracker().addAttachment('PROJ-2', '/tmp/clip.MOV')

    const [, files] = upload.mock.calls[0] as [string, File[]]
    const [file] = files
    expect(file?.type).toBe('video/quicktime')
  })

  it('rejects when the redirect Location is not a media file URL', async () => {
    upload.mockResolvedValue([{ id: '30003', filename: 'before.png', mimeType: 'image/png' }])
    locationFor.mockResolvedValue('https://acme.atlassian.net/login?dest=/attachment/content/30003')

    await expect(makeTracker().addAttachment('PROJ-2', '/tmp/before.png')).rejects.toThrow(/media file URL/)
    await expect(makeTracker().addAttachment('PROJ-2', '/tmp/before.png')).rejects.toThrow(/30003/)
  })

  it('resolves the UUID from the real absolute media URL Jira returns', async () => {
    upload.mockResolvedValue([{ id: '40004', filename: 'before.png', mimeType: 'image/png' }])
    locationFor.mockResolvedValue(
      'https://media.atlassian.com/file/abcdef01-2345-6789-abcd-ef0123456789/binary?token=xyz',
    )

    const attachment = await makeTracker().addAttachment('PROJ-2', '/tmp/before.png')

    expect(attachment.mediaUuid).toBe('abcdef01-2345-6789-abcd-ef0123456789')
  })

  it('rejects a query-string-only match that is not on the redirect path', async () => {
    upload.mockResolvedValue([{ id: '50005', filename: 'before.png', mimeType: 'image/png' }])
    locationFor.mockResolvedValue('/login?dest=/file/12345678-1234-1234-1234-123456789abc/binary')

    await expect(makeTracker().addAttachment('PROJ-2', '/tmp/before.png')).rejects.toThrow(/media file URL/)
    await expect(makeTracker().addAttachment('PROJ-2', '/tmp/before.png')).rejects.toThrow(/50005/)
  })

  it('rejects a trailing suffix on the binary segment', async () => {
    upload.mockResolvedValue([{ id: '60006', filename: 'before.png', mimeType: 'image/png' }])
    locationFor.mockResolvedValue('/file/12345678-1234-1234-1234-123456789abc/binary-invalid')

    await expect(makeTracker().addAttachment('PROJ-2', '/tmp/before.png')).rejects.toThrow(/media file URL/)
    await expect(makeTracker().addAttachment('PROJ-2', '/tmp/before.png')).rejects.toThrow(/60006/)
  })

  it('rejects a non-URL Location whose path merely contains the media segment', async () => {
    upload.mockResolvedValue([{ id: '70007', filename: 'before.png', mimeType: 'image/png' }])
    locationFor.mockResolvedValue('not-a-url/file/12345678-1234-1234-1234-123456789abc/binary')

    await expect(makeTracker().addAttachment('PROJ-2', '/tmp/before.png')).rejects.toThrow(/media file URL/)
    await expect(makeTracker().addAttachment('PROJ-2', '/tmp/before.png')).rejects.toThrow(/70007/)
  })

  it('rejects an off-contract upload response before locationFor is called', async () => {
    upload.mockResolvedValue([{ id: '10001' }])

    await expect(makeTracker().addAttachment('PROJ-2', '/tmp/before.png')).rejects.toThrow()
    expect(locationFor).not.toHaveBeenCalled()
  })
})
