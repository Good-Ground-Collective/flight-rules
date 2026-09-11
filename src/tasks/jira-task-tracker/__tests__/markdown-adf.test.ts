import { describe, it, expect } from 'vitest'
import { markdownAdfConverter, type MediaLookup } from '../markdown-adf.js'
import type { AdfNode } from '../adf.js'
import { roundTripCases } from './round-trip-cases.js'

const roundTrip = (markdown: string): string => markdownAdfConverter.toMarkdown(markdownAdfConverter.toAdf(markdown).content)

describe('markdownAdfConverter.toAdf', () => {
  it('converts a heading to a heading node with its level', () => {
    const doc = markdownAdfConverter.toAdf('## Problem Statement')
    expect(doc.content).toEqual([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Problem Statement' }] },
    ])
  })

  it('converts bold and inline code to marked text nodes', () => {
    const doc = markdownAdfConverter.toAdf('Run **all** the `flight-rules check` command')
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Run ' },
          { type: 'text', text: 'all', marks: [{ type: 'strong' }] },
          { type: 'text', text: ' the ' },
          { type: 'text', text: 'flight-rules check', marks: [{ type: 'code' }] },
          { type: 'text', text: ' command' },
        ],
      },
    ])
  })

  it('converts an inline markdown link to a text node with a link mark', () => {
    const doc = markdownAdfConverter.toAdf('See the [source](https://example.com/x.ts) for details')
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See the ' },
          { type: 'text', text: 'source', marks: [{ type: 'link', attrs: { href: 'https://example.com/x.ts' } }] },
          { type: 'text', text: ' for details' },
        ],
      },
    ])
  })

  it('composes marks when a link label is itself bold or code', () => {
    const doc = markdownAdfConverter.toAdf('[**bold**](https://a.dev) and [`code`](https://b.dev)')
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'bold', marks: [{ type: 'link', attrs: { href: 'https://a.dev' } }, { type: 'strong' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'code', marks: [{ type: 'link', attrs: { href: 'https://b.dev' } }, { type: 'code' }] },
        ],
      },
    ])
  })

  it('converts a fenced code block to a codeBlock with its language', () => {
    const doc = markdownAdfConverter.toAdf('```ts\nconst x = 1\n```')
    expect(doc.content).toEqual([
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1' }] },
    ])
  })

  it('converts checkboxes to a taskList with TODO/DONE states', () => {
    const doc = markdownAdfConverter.toAdf('- [ ] first\n- [x] second')
    const [taskList] = doc.content
    expect(taskList?.type).toBe('taskList')
    expect(taskList?.content?.map((item) => item.attrs?.['state'])).toEqual(['TODO', 'DONE'])
    // ADF taskItem is inline-only, so it holds the paragraph's inline text directly (see FINDING 2).
    expect(taskList?.content?.[0]?.content).toEqual([{ type: 'text', text: 'first' }])
  })

  it('converts bullets to a bulletList of listItem paragraphs', () => {
    const doc = markdownAdfConverter.toAdf('- one\n- two')
    expect(doc.content).toEqual([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
        ],
      },
    ])
  })

  it('converts a <details> block to an expand with converted children', () => {
    const doc = markdownAdfConverter.toAdf('<details><summary>Guided Walkthrough</summary>\n\nStep one.\n\n</details>')
    expect(doc.content).toEqual([
      {
        type: 'expand',
        attrs: { title: 'Guided Walkthrough' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step one.' }] }],
      },
    ])
  })

  it('handles a <summary> on its own line (LLM Context form)', () => {
    const doc = markdownAdfConverter.toAdf('<details>\n<summary>LLM Context</summary>\n\n```yaml\nnotes: hi\n```\n\n</details>')
    const [expand] = doc.content
    expect(expand?.attrs).toEqual({ title: 'LLM Context' })
    expect(expand?.content?.some((n) => n.type === 'codeBlock')).toBe(true)
  })

  it('splits a soft line break into text, hardBreak, text within one paragraph', () => {
    const doc = markdownAdfConverter.toAdf('line one\nline two')
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'line one' },
          { type: 'hardBreak' },
          { type: 'text', text: 'line two' },
        ],
      },
    ])
  })

  it('splits a loose bullet list into two sibling bulletList nodes', () => {
    const doc = markdownAdfConverter.toAdf('- a\n\n- b')
    expect(doc.content).toEqual([
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] }],
      },
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }],
      },
    ])
  })

  it('converts an ordered list with a start offset to attrs.order', () => {
    const doc = markdownAdfConverter.toAdf('3. third\n4. fourth')
    const [list] = doc.content
    expect(list?.type).toBe('orderedList')
    expect(list?.attrs).toEqual({ order: 3 })
  })

  it('leaves attrs off an ordered list that starts at one', () => {
    const doc = markdownAdfConverter.toAdf('1. first\n2. second')
    const [list] = doc.content
    expect(list?.type).toBe('orderedList')
    expect(list?.attrs).toBeUndefined()
  })

  it('converts a thematic break to a rule node', () => {
    expect(markdownAdfConverter.toAdf('---').content).toEqual([{ type: 'rule' }])
  })

  it('produces an empty doc for an empty body', () => {
    expect(markdownAdfConverter.toAdf('').content).toEqual([])
  })
})

describe('markdown ⇄ ADF round-trip', () => {
  it.each(roundTripCases)('round-trips a %s byte-equivalently', (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it('round-trips nested details byte-equivalently', () => {
    // Kept out of the shared, schema-validated corpus: nested <details> emits an
    // `expand` inside an `expand`, which the ADF schema rejects, but the bytes
    // still round-trip.
    const markdown =
      '<details><summary>Outer</summary>\n\n<details><summary>Inner</summary>\n\ndeep\n\n</details>\n\n</details>'
    expect(roundTrip(markdown)).toBe(markdown)
  })

  it('round-trips the full layered-body template', () => {
    const body = [
      '## Problem Statement',
      '',
      'Users see raw markdown in the Jira UI.',
      '',
      '## Acceptance Criteria',
      '',
      '- [ ] Formatted content renders in Jira',
      '- [ ] `ticket get` still returns markdown',
      '',
      '## High-level technical writeup',
      '',
      'Convert **markdown** to ADF on write and back on read.',
      '',
      '<details><summary>Guided Walkthrough</summary>',
      '',
      'Start with the converter:',
      '',
      '```ts',
      'markdownAdfConverter.toAdf(body)',
      '```',
      '',
      '- keep the subset small',
      '- degrade gracefully',
      '',
      '</details>',
    ].join('\n')

    expect(roundTrip(body)).toBe(body)
  })
})

describe('markdownAdfConverter inline media', () => {
  const media: MediaLookup = { 'before.png': { mediaUuid: 'u', collection: '', width: 1200, height: 800 } }
  const sized = (markdown: string): AdfNode | undefined => markdownAdfConverter.toAdf(markdown, media).content[0]

  it('emits a single-image paragraph as mediaSingle wrapping media', () => {
    expect(sized('![BEFORE](./before.png)')).toEqual({
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [
        { type: 'media', attrs: { type: 'file', id: 'u', collection: '', alt: 'BEFORE', width: 1200, height: 800 } },
      ],
    })
  })

  it('omits width and height when the lookup has none', () => {
    const withoutSize: MediaLookup = { 'before.png': { mediaUuid: 'u', collection: '' } }
    expect(markdownAdfConverter.toAdf('![BEFORE](./before.png)', withoutSize).content[0]).toEqual({
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [{ type: 'media', attrs: { type: 'file', id: 'u', collection: '', alt: 'BEFORE' } }],
    })
  })

  it('resolves a target that matches a media UUID', () => {
    expect(sized('![BEFORE](attachment:u)')?.type).toBe('mediaSingle')
  })

  it('keeps an unresolved image literal', () => {
    expect(sized('![X](./missing.png)')).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: '![X](./missing.png)' }],
    })
  })

  it('keeps an image mid-sentence literal', () => {
    const paragraph = sized('inline ![a](./before.png) image')
    expect(paragraph?.type).toBe('paragraph')
    expect((paragraph?.content ?? []).map((node) => node.text ?? '').join('')).toBe('inline ![a](./before.png) image')
  })

  it('reads a media node back to an attachment reference via the lookup', () => {
    const node = sized('![BEFORE](./before.png)')
    expect(node).toBeDefined()
    expect(markdownAdfConverter.toMarkdown(node === undefined ? [] : [node], media)).toBe('![BEFORE](attachment:before.png)')
  })

  it('degrades to the media UUID without a lookup', () => {
    const node = sized('![BEFORE](./before.png)')
    expect(markdownAdfConverter.toMarkdown(node === undefined ? [] : [node])).toBe('![BEFORE](attachment:u)')
  })

  it('reads an external media node back to its url', () => {
    const nodes: AdfNode[] = [
      {
        type: 'mediaSingle',
        attrs: { layout: 'center' },
        content: [{ type: 'media', attrs: { type: 'external', url: 'https://x.dev/d.png', alt: 'diagram' } }],
      },
    ]
    expect(markdownAdfConverter.toMarkdown(nodes)).toBe('![diagram](https://x.dev/d.png)')
  })

  it('reads a mediaInline node back inline in its paragraph', () => {
    const nodes: AdfNode[] = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'see ' },
          { type: 'mediaInline', attrs: { type: 'file', id: 'u' } },
          { type: 'text', text: ' here' },
        ],
      },
    ]
    expect(markdownAdfConverter.toMarkdown(nodes, media)).toBe('see ![](attachment:before.png) here')
  })

  it('round-trips the attachment reference byte-identically with a lookup', () => {
    const markdown = '![BEFORE](attachment:before.png)'
    expect(markdownAdfConverter.toMarkdown(markdownAdfConverter.toAdf(markdown, media).content, media)).toBe(markdown)
  })

  it('normalizes a local image path to the attachment reference', () => {
    expect(
      markdownAdfConverter.toMarkdown(markdownAdfConverter.toAdf('![BEFORE](./before.png)', media).content, media),
    ).toBe('![BEFORE](attachment:before.png)')
  })

  it('never resolves an inherited object property to id-less media', () => {
    for (const key of ['constructor', 'toString', '__proto__']) {
      expect(sized(`![x](attachment:${key})`)).toEqual({
        type: 'paragraph',
        content: [{ type: 'text', text: `![x](attachment:${key})` }],
      })
    }
  })

  it('keeps a resolving image literal inside a panel and a list item', () => {
    const contains = (node: AdfNode, type: string): boolean =>
      node.type === type || (node.content ?? []).some((child) => contains(child, type))
    const panel = markdownAdfConverter.toAdf('> [!NOTE]\n> ![BEFORE](./before.png)', media).content
    const list = markdownAdfConverter.toAdf('- ![BEFORE](./before.png)', media).content
    for (const node of [...panel, ...list]) {
      expect(contains(node, 'mediaSingle')).toBe(false)
      expect(contains(node, 'media')).toBe(false)
    }
  })

  it('leaves an external image literal even when its basename collides with a lookup entry', () => {
    const markdown = '![x](https://example.com/before.png)'
    expect(sized(markdown)).toEqual({ type: 'paragraph', content: [{ type: 'text', text: markdown }] })
    expect(markdownAdfConverter.toMarkdown(markdownAdfConverter.toAdf(markdown, media).content, media)).toBe(markdown)
  })

  it('round-trips an attachment whose filename and alt need escaping', () => {
    const tricky: MediaLookup = { 'screen shot.png': { mediaUuid: 's', collection: '' } }
    const nodes: AdfNode[] = [
      {
        type: 'mediaSingle',
        attrs: { layout: 'center' },
        content: [{ type: 'media', attrs: { type: 'file', id: 's', collection: '', alt: 'a] b (c) \\ &copy;' } }],
      },
    ]
    const markdown = markdownAdfConverter.toMarkdown(nodes, tricky)
    expect(markdownAdfConverter.toAdf(markdown, tricky).content).toEqual(nodes)
    expect(markdownAdfConverter.toMarkdown(markdownAdfConverter.toAdf(markdown, tricky).content, tricky)).toBe(markdown)
  })

  it('escapes an external destination containing a space and parentheses', () => {
    const nodes: AdfNode[] = [
      {
        type: 'mediaSingle',
        attrs: { layout: 'center' },
        content: [{ type: 'media', attrs: { type: 'external', url: 'https://x.dev/a (b).png', alt: 'x' } }],
      },
    ]
    const markdown = markdownAdfConverter.toMarkdown(nodes)
    expect(markdown).toBe('![x](<https://x.dev/a (b).png>)')
    // An external URL is never written back as media, so it re-reads as its own literal markdown, byte-stably.
    expect(roundTrip(markdown)).toBe(markdown)
    expect(roundTrip(roundTrip(markdown))).toBe(markdown)
  })
})

describe('markdownAdfConverter.toAdf mark and nesting shapes', () => {
  const firstText = (markdown: string): AdfNode | undefined =>
    markdownAdfConverter.toAdf(markdown).content[0]?.content?.[0]

  const markTypes = (node: AdfNode | undefined): string[] => (node?.marks ?? []).map((mark) => mark.type).sort()

  it('flattens ~~***x***~~ onto one text node carrying strike, em, and strong', () => {
    const paragraph = markdownAdfConverter.toAdf('~~***x***~~').content[0]
    expect(paragraph?.content).toHaveLength(1)
    const [text] = paragraph?.content ?? []
    expect(text?.text).toBe('x')
    expect(markTypes(text)).toEqual(['em', 'strike', 'strong'])
  })

  it('carries strong and link with an href on a bold link label', () => {
    const text = firstText('[**x**](https://u)')
    expect(markTypes(text)).toEqual(['link', 'strong'])
    const link = text?.marks?.find((mark) => mark.type === 'link')
    expect(link?.attrs).toEqual({ href: 'https://u' })
  })

  it('records href and title on a titled link', () => {
    const text = firstText('[x](https://u "T")')
    const link = text?.marks?.find((mark) => mark.type === 'link')
    expect(link?.attrs).toEqual({ href: 'https://u', title: 'T' })
  })

  it('maps a nested bullet to a listItem holding [paragraph, bulletList]', () => {
    const [bulletList] = markdownAdfConverter.toAdf('- outer\n  - inner').content
    const [listItem] = bulletList?.content ?? []
    expect(listItem?.type).toBe('listItem')
    expect(listItem?.content?.map((child) => child.type)).toEqual(['paragraph', 'bulletList'])
  })
})

describe('markdownAdfConverter round-trip fidelity (adversarial review)', () => {
  // toAdf → toMarkdown → toAdf must be stable: re-parsing the emitted markdown
  // yields the same ADF, so no content is lost or corrupted on a round trip.
  const adfStable = (nodes: AdfNode[]): void => {
    const markdown = markdownAdfConverter.toMarkdown(nodes)
    expect(markdownAdfConverter.toAdf(markdown).content).toEqual(nodes)
  }
  const linkPara = (text: string, attrs: Record<string, unknown>): AdfNode[] => [
    { type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'link', attrs }] }] },
  ]

  describe('FINDING 1 — link destination and title are escaped', () => {
    it('keeps a literal ampersand entity in an href from re-decoding', () => {
      adfStable(linkPara('x', { href: 'https://u/?q=&copy;' }))
    })

    it('keeps a bare ampersand in an href intact', () => {
      adfStable(linkPara('x', { href: 'https://u/?a=1&b=2' }))
    })

    it('escapes a double quote inside a link title', () => {
      adfStable(linkPara('x', { href: 'https://u', title: 'say "hi"' }))
    })

    it('wraps a destination containing a space in angle brackets', () => {
      adfStable(linkPara('x', { href: 'https://u/a b' }))
    })
  })

  describe('FINDING 2 — taskItem is inline-only; list-item children survive', () => {
    const holdsBlock = (node: AdfNode | undefined): boolean =>
      (node?.content ?? []).some((child) =>
        ['paragraph', 'bulletList', 'orderedList', 'taskList'].includes(child.type),
      )

    it('emits a flat task list as inline-only taskItems that round-trip', () => {
      const markdown = '- [ ] first\n- [x] second'
      const doc = markdownAdfConverter.toAdf(markdown)
      const [taskList] = doc.content
      expect(taskList?.type).toBe('taskList')
      expect(taskList?.content?.[0]?.content).toEqual([{ type: 'text', text: 'first' }])
      expect(taskList?.content?.[1]?.content).toEqual([{ type: 'text', text: 'second' }])
      // No taskItem carries a paragraph or nested list — that would be invalid Jira ADF.
      expect((taskList?.content ?? []).some(holdsBlock)).toBe(false)
      expect(markdownAdfConverter.toMarkdown(doc.content)).toBe(markdown)
    })

    it('keeps a task item with a mark inline and valid', () => {
      const doc = markdownAdfConverter.toAdf('- [ ] ship **now**')
      const taskItem = doc.content[0]?.content?.[0]
      expect(taskItem?.content).toEqual([
        { type: 'text', text: 'ship ' },
        { type: 'text', text: 'now', marks: [{ type: 'strong' }] },
      ])
      expect(holdsBlock(taskItem)).toBe(false)
    })

    it('preserves a nested child list without putting a block inside the taskItem', () => {
      const doc = markdownAdfConverter.toAdf('- [ ] parent\n  - child')
      const [taskList, sibling] = doc.content
      expect(taskList?.type).toBe('taskList')
      // The taskItem stays inline; the nested child spills to a sibling block.
      expect(taskList?.content?.[0]?.content).toEqual([{ type: 'text', text: 'parent' }])
      expect((taskList?.content ?? []).some(holdsBlock)).toBe(false)
      expect(sibling?.type).toBe('bulletList')
      expect(JSON.stringify(sibling)).toContain('child')
    })

    it('preserves both paragraphs of a two-paragraph bullet list item (listItem is block content)', () => {
      const markdown = '- first para\n\n  second para'
      const doc = markdownAdfConverter.toAdf(markdown)
      const listItem = doc.content[0]?.content?.[0]
      expect(listItem?.content?.map((child) => child.type)).toEqual(['paragraph', 'paragraph'])
      expect(markdownAdfConverter.toAdf(markdownAdfConverter.toMarkdown(doc.content)).content).toEqual(doc.content)
    })
  })

  describe('FINDING 3 — shared marks coalesce across adjacent text nodes', () => {
    const stableFromMarkdown = (markdown: string): void => {
      const adf = markdownAdfConverter.toAdf(markdown)
      const reparsed = markdownAdfConverter.toAdf(markdownAdfConverter.toMarkdown(adf.content))
      expect(reparsed.content).toEqual(adf.content)
    }

    it('keeps a bold span wrapping a link as a single strong mark', () => {
      stableFromMarkdown('**before [x](https://u) after**')
    })

    it('does not duplicate a strong mark nested inside emphasis', () => {
      stableFromMarkdown('*before **bold** after*')
    })
  })

  describe('FINDING 4 — literal text is escaped so it does not re-parse as syntax', () => {
    it('keeps decoded emphasis markers literal', () => {
      adfStable([{ type: 'paragraph', content: [{ type: 'text', text: 'literal *x*' }] }])
    })
  })
})

describe('markdownAdfConverter normalizations', () => {
  it('rewrites underscore emphasis to asterisks', () => {
    expect(roundTrip('Ship _now_ today')).toBe('Ship *now* today')
  })

  it('collapses four-space nesting to the marker width', () => {
    expect(roundTrip('- a\n    - b')).toBe('- a\n  - b')
  })

  it('renumbers an ordered list from its start', () => {
    expect(roundTrip('1. a\n1. b')).toBe('1. a\n2. b')
  })

  it('drops bold from a code span', () => {
    expect(roundTrip('Use **`x`** here')).toBe('Use `x` here')
  })

  it('normalizes a star bullet to a dash', () => {
    expect(roundTrip('* star bullet')).toBe('- star bullet')
  })

  it('emits a text node carrying an underline mark as plain text', () => {
    const nodes: AdfNode[] = [
      { type: 'paragraph', content: [{ type: 'text', text: 'plain', marks: [{ type: 'underline' }] }] },
    ]
    expect(markdownAdfConverter.toMarkdown(nodes)).toBe('plain')
  })
})

describe('markdownAdfConverter.toAdf <details> resilience (KAN-38)', () => {
  it('parses a details block that mentions <details> tags in inline code as one expand', () => {
    const body = [
      '<details><summary>Guided Walkthrough</summary>',
      '',
      'Match the `<details>` block whose `<summary>` reads Guided Walkthrough.',
      '',
      '</details>',
    ].join('\n')
    const doc = markdownAdfConverter.toAdf(body)
    expect(doc.content).toHaveLength(1)
    expect(doc.content[0]?.type).toBe('expand')
    expect(doc.content[0]?.attrs).toEqual({ title: 'Guided Walkthrough' })
  })

  it('round-trips a details block that mentions tags in prose', () => {
    const body = [
      '<details><summary>Guided Walkthrough</summary>',
      '',
      'Ignore any `<details>` mentioned mid-sentence.',
      '',
      '</details>',
    ].join('\n')
    expect(markdownAdfConverter.toMarkdown(markdownAdfConverter.toAdf(body).content)).toBe(body)
  })

  it('degrades an unclosed <details> to paragraph text instead of looping', () => {
    const doc = markdownAdfConverter.toAdf('<details><summary>Oops</summary>\n\nno closing tag here')
    expect(doc.content.length).toBeGreaterThan(0)
    expect(doc.content.every((node) => node.type !== 'expand')).toBe(true)
  })
})

describe('markdownAdfConverter.toAdf tables, blockquotes, and admonitions', () => {
  // ADF content models: a blockquote never holds a heading or a nested quote, and
  // a panel never holds a code block, table, panel, or quote. Both require at least
  // one child. This walks a whole toAdf result and fails on any illegal child or
  // empty container.
  const assertContentModel = (node: AdfNode): void => {
    if (node.type === 'blockquote' || node.type === 'panel') expect((node.content ?? []).length).toBeGreaterThan(0)
    for (const child of node.content ?? []) {
      if (node.type === 'blockquote') expect(['heading', 'blockquote']).not.toContain(child.type)
      if (node.type === 'panel') expect(['codeBlock', 'table', 'panel', 'blockquote']).not.toContain(child.type)
      assertContentModel(child)
    }
  }

  const bodies = [
    '> [!NOTE]\n> body',
    '> [!TIP]\n> body',
    '> [!IMPORTANT]\n> body',
    '> [!WARNING]\n> body',
    '> [!CAUTION]\n> body',
    '> ## heading\n> body',
    '> outer\n>\n> > inner',
    '> [!NOTE]\n> Run:\n>\n> ```sh\n> npm test\n> ```',
    '| Field | Value |\n| --- | --- |\n| a | b |',
    '> [!NOTE]',
    '>',
    '> > one\n> > two',
    '> | A | B |\n> | --- | --- |\n> | a | b |',
    '> - [ ] one\n> - [x] two',
  ]

  it.each(bodies)('emits schema-valid container content for %#', (markdown) => {
    for (const node of markdownAdfConverter.toAdf(markdown).content) assertContentModel(node)
  })

  const repeated: Array<[string, string]> = [
    ['a multiline nested quote', '> > one\n> > two'],
    ['a quoted table', '> | A | B |\n> | --- | --- |\n> | a | b |'],
    ['a quoted task list', '> - [ ] one\n> - [x] two'],
  ]

  it.each(repeated)('stays stable across two round trips for %s', (_name, markdown) => {
    const first = roundTrip(markdown)
    const second = roundTrip(first)
    expect(second).toBe(first)
    // A demoted child must not accrete an outer quote prefix on each pass.
    expect(first).toBe(markdown)
  })

  it('gives a marker-only alert a single empty paragraph, never an empty panel', () => {
    const [panel] = markdownAdfConverter.toAdf('> [!NOTE]').content
    expect(panel?.type).toBe('panel')
    expect(panel?.content).toEqual([{ type: 'paragraph', content: [] }])
    expect(roundTrip('> [!NOTE]')).toBe('> [!NOTE]')
  })

  it('gives a bare quote a single empty paragraph, never an empty blockquote', () => {
    const [quote] = markdownAdfConverter.toAdf('>').content
    expect(quote?.type).toBe('blockquote')
    expect(quote?.content).toEqual([{ type: 'paragraph', content: [] }])
    expect(roundTrip('>')).toBe('>')
  })

  const markerPanels: Array<[string, string]> = [
    ['NOTE', 'info'],
    ['TIP', 'success'],
    ['IMPORTANT', 'note'],
    ['WARNING', 'warning'],
    ['CAUTION', 'error'],
  ]

  it.each(markerPanels)('maps a [!%s] admonition to a %s panel', (marker, panelType) => {
    const [panel] = markdownAdfConverter.toAdf(`> [!${marker}]\n> body`).content
    expect(panel?.type).toBe('panel')
    expect(panel?.attrs).toEqual({ panelType })
  })

  it('falls an alert with a code fence back to a blockquote keeping the marker literal', () => {
    const [quote] = markdownAdfConverter.toAdf('> [!NOTE]\n>\n> ```sh\n> npm test\n> ```').content
    expect(quote?.type).toBe('blockquote')
    expect(quote?.content?.[0]).toEqual({ type: 'paragraph', content: [{ type: 'text', text: '[!NOTE]' }] })
    expect(quote?.content?.[1]?.type).toBe('codeBlock')
  })

  it('uses tableHeader for the first row and tableCell after, with no alignment attribute', () => {
    const [table] = markdownAdfConverter.toAdf('| A | B |\n| :--- | ---: |\n| a | b |').content
    expect(table?.content?.[0]?.content?.map((cell) => cell.type)).toEqual(['tableHeader', 'tableHeader'])
    expect(table?.content?.[1]?.content?.map((cell) => cell.type)).toEqual(['tableCell', 'tableCell'])
    expect(JSON.stringify(table)).not.toContain('align')
  })

  it('gives an empty cell an empty paragraph so every cell has block content', () => {
    const [table] = markdownAdfConverter.toAdf('| A | B |\n| --- | --- |\n| a |  |').content
    expect(table?.content?.[1]?.content?.[1]?.content).toEqual([{ type: 'paragraph', content: [] }])
  })
})

describe('markdownAdfConverter table and quote normalizations', () => {
  const emit = (nodes: AdfNode[]): string => markdownAdfConverter.toMarkdown(nodes)

  it('drops column alignment to a plain --- delimiter', () => {
    expect(roundTrip('| A | B |\n| :--- | ---: |\n| 1 | 2 |')).toBe('| A | B |\n| --- | --- |\n| 1 | 2 |')
  })

  it('joins a multi-paragraph cell into one space-separated line', () => {
    const table: AdfNode[] = [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                attrs: {},
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
                  { type: 'paragraph', content: [{ type: 'text', text: 'two' }] },
                ],
              },
            ],
          },
        ],
      },
    ]
    expect(emit(table)).toBe('| one two |\n| --- |')
  })

  it('reads a first row of tableCell back as the GFM header', () => {
    const table: AdfNode[] = [
      {
        type: 'table',
        attrs: { isNumberColumnEnabled: true },
        content: [
          { type: 'tableRow', content: [{ type: 'tableCell', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H' }] }] }] },
          { type: 'tableRow', content: [{ type: 'tableCell', attrs: {}, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] }] },
        ],
      },
    ]
    expect(emit(table)).toBe('| H |\n| --- |\n| b |')
  })

  it('renders an unknown panelType as a plain blockquote', () => {
    const nodes: AdfNode[] = [
      { type: 'panel', attrs: { panelType: 'custom' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }] },
    ]
    expect(emit(nodes)).toBe('> hi')
  })
})

describe('markdownAdfConverter.toMarkdown graceful degradation', () => {
  it('flattens unknown block nodes to their text content', () => {
    const nodes: AdfNode[] = [
      {
        type: 'layoutSection',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'from the UI' }] }],
      },
    ]
    expect(markdownAdfConverter.toMarkdown(nodes)).toBe('from the UI')
  })

  it('renders link marks as markdown links', () => {
    const nodes: AdfNode[] = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://x.dev' } }] }],
      },
    ]
    expect(markdownAdfConverter.toMarkdown(nodes)).toBe('[docs](https://x.dev)')
  })

  it('collapses a link whose text equals its href to a bare url', () => {
    const nodes: AdfNode[] = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'https://x.dev', marks: [{ type: 'link', attrs: { href: 'https://x.dev' } }] }],
      },
    ]
    expect(markdownAdfConverter.toMarkdown(nodes)).toBe('https://x.dev')
  })

  it('renders ordered lists with numeric markers', () => {
    const nodes: AdfNode[] = [
      {
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] },
        ],
      },
    ]
    expect(markdownAdfConverter.toMarkdown(nodes)).toBe('1. one\n2. two')
  })
})

describe('markdownAdfConverter @mentions', () => {
  const firstParagraph = (markdown: string): AdfNode[] =>
    markdownAdfConverter.toAdf(markdown).content[0]?.content ?? []

  it('splits a leading mention from the following text', () => {
    expect(firstParagraph('@{5b10|Ada Lovelace} please look')).toEqual([
      { type: 'mention', attrs: { id: '5b10', text: '@Ada Lovelace' } },
      { type: 'text', text: ' please look' },
    ])
  })

  it('places a mention mid-sentence between two text nodes', () => {
    expect(firstParagraph('Ping @{5b10|Ada Lovelace} today')).toEqual([
      { type: 'text', text: 'Ping ' },
      { type: 'mention', attrs: { id: '5b10', text: '@Ada Lovelace' } },
      { type: 'text', text: ' today' },
    ])
  })

  it('produces a mention inside a heading', () => {
    const heading = markdownAdfConverter.toAdf('## Owner @{a1|Ada}').content[0]
    expect(heading?.type).toBe('heading')
    expect(heading?.content).toEqual([
      { type: 'text', text: 'Owner ' },
      { type: 'mention', attrs: { id: 'a1', text: '@Ada' } },
    ])
  })

  it('produces a mention inside a bullet list item', () => {
    const listItem = markdownAdfConverter.toAdf('- ping @{a1|Ada}').content[0]?.content?.[0]
    expect(listItem?.content?.[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'ping ' },
        { type: 'mention', attrs: { id: 'a1', text: '@Ada' } },
      ],
    })
  })

  it('keeps a mention beside a bold span as its own inline node', () => {
    expect(firstParagraph('@{a1|Ada} **now**')).toEqual([
      { type: 'mention', attrs: { id: 'a1', text: '@Ada' } },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'now', marks: [{ type: 'strong' }] },
    ])
  })

  it('carries a mention through a bold span it sits inside', () => {
    expect(firstParagraph('**hi @{a1|Ada} there**')).toEqual([
      { type: 'text', text: 'hi ', marks: [{ type: 'strong' }] },
      { type: 'mention', attrs: { id: 'a1', text: '@Ada' } },
      { type: 'text', text: ' there', marks: [{ type: 'strong' }] },
    ])
  })

  it('omits attrs.text when the display half is empty', () => {
    expect(firstParagraph('@{a1|}')).toEqual([{ type: 'mention', attrs: { id: 'a1' } }])
  })

  it('leaves a mention token inside a code span as literal code', () => {
    expect(firstParagraph('`@{a|b}`')).toEqual([{ type: 'text', text: '@{a|b}', marks: [{ type: 'code' }] }])
  })

  it('leaves a mention token inside a fenced block untouched', () => {
    expect(markdownAdfConverter.toAdf('```\n@{a|b}\n```').content).toEqual([
      { type: 'codeBlock', attrs: {}, content: [{ type: 'text', text: '@{a|b}' }] },
    ])
  })

  it('leaves a pipe-less @{Name} as literal text', () => {
    expect(firstParagraph('@{Ada}')).toEqual([{ type: 'text', text: '@{Ada}' }])
  })

  it('treats an escaped \\@{a|b} as literal text', () => {
    expect(firstParagraph('\\@{a|b}')).toEqual([{ type: 'text', text: '@{a|b}' }])
  })

  it('emits a mention node as @{id|display}', () => {
    const nodes: AdfNode[] = [
      { type: 'paragraph', content: [{ type: 'mention', attrs: { id: '5b10', text: '@Ada Lovelace' } }] },
    ]
    expect(markdownAdfConverter.toMarkdown(nodes)).toBe('@{5b10|Ada Lovelace}')
  })

  it('emits @{id|} for a mention with no display text', () => {
    const nodes: AdfNode[] = [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: '5b10' } }] }]
    expect(markdownAdfConverter.toMarkdown(nodes)).toBe('@{5b10|}')
  })

  it('round-trips a mention inside a bold span stably', () => {
    const nodes: AdfNode[] = [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'hi ', marks: [{ type: 'strong' }] },
          { type: 'mention', attrs: { id: 'a1', text: '@Ada' } },
          { type: 'text', text: ' there', marks: [{ type: 'strong' }] },
        ],
      },
    ]
    expect(markdownAdfConverter.toAdf(markdownAdfConverter.toMarkdown(nodes)).content).toEqual(nodes)
  })

  it('escapes a literal text node that reads as a mention so it stays text', () => {
    const nodes: AdfNode[] = [{ type: 'paragraph', content: [{ type: 'text', text: '@{a|b}' }] }]
    expect(markdownAdfConverter.toMarkdown(nodes)).toBe('\\@{a|b}')
    expect(markdownAdfConverter.toAdf(markdownAdfConverter.toMarkdown(nodes)).content).toEqual(nodes)
  })

  describe('escape decisions come from source position, not match order', () => {
    it('keeps an escaped mention literal even when an entity precedes it', () => {
      // `&#64;` decodes to `@`, so the decoded value gains a match with no source
      // counterpart; an ordinal pairing would hand its escape flag to the wrong
      // token and @-mention a user the author escaped.
      expect(firstParagraph('&#64;{a|Ada} \\@{b|Bob}')).toEqual([{ type: 'text', text: '@{a|Ada} @{b|Bob}' }])
    })

    it('never emits a mention when both tokens are literal', () => {
      const content = firstParagraph('&#64;{a|Ada} \\@{b|Bob}')
      expect(content.some((node) => node.type === 'mention')).toBe(false)
    })

    it('decodes an entity inside a real mention display', () => {
      expect(firstParagraph('@{a|Ada &amp; Co}')).toEqual([{ type: 'mention', attrs: { id: 'a', text: '@Ada & Co' } }])
    })
  })

  describe('a mention is a boundary that open marks close at', () => {
    const adfStable = (nodes: AdfNode[]): void => {
      const markdown = markdownAdfConverter.toMarkdown(nodes)
      expect(markdownAdfConverter.toAdf(markdown).content).toEqual(nodes)
    }
    const para = (content: AdfNode[]): AdfNode[] => [{ type: 'paragraph', content }]
    const strong = (text: string): AdfNode => ({ type: 'text', text, marks: [{ type: 'strong' }] })
    const em = (text: string): AdfNode => ({ type: 'text', text, marks: [{ type: 'em' }] })
    const mention: AdfNode = { type: 'mention', attrs: { id: 'a', text: '@Ada' } }

    it('closes a code span before a following mention', () => {
      const nodes = para([{ type: 'text', text: 'code', marks: [{ type: 'code' }] }, mention])
      expect(markdownAdfConverter.toMarkdown(nodes)).toBe('`code`@{a|Ada}')
      adfStable(nodes)
    })

    it('round-trips a mention immediately at the start of a bold span', () => {
      adfStable(para([mention, strong('after')]))
    })

    it('keeps the bold when a mention starts a span whose text has a leading space', () => {
      // `** after**` is invalid CommonMark, so the space migrates outside the
      // delimiters; the bold survives on "there" instead of being lost.
      const md = markdownAdfConverter.toMarkdown(markdownAdfConverter.toAdf('**@{a|Ada} there**').content)
      expect(md).toBe('@{a|Ada} **there**')
      expect(markdownAdfConverter.toMarkdown(markdownAdfConverter.toAdf(md).content)).toBe(md)
    })

    it('round-trips a mention in the middle of a bold span', () => {
      adfStable(para([strong('before '), mention, strong(' after')]))
    })

    it('round-trips a mention at the end of a bold span', () => {
      adfStable(para([strong('before '), mention]))
    })

    it('round-trips a mention in the middle of an emphasis span', () => {
      adfStable(para([em('before '), mention, em(' after')]))
    })
  })

  describe('display names are escaped so the token stays atomic', () => {
    const stable = (text: string): void => {
      const nodes: AdfNode[] = [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'a', text } }] }]
      expect(markdownAdfConverter.toAdf(markdownAdfConverter.toMarkdown(nodes)).content).toEqual(nodes)
    }

    it('round-trips a display with markdown emphasis markers', () => stable('@Ada *Dev*'))
    it('round-trips a display with braces', () => stable('@Ada {Dev}'))
    it('round-trips a display with a backslash', () => stable('@Ada \\ Dev'))
    it('round-trips a display with an entity-like sequence', () => stable('@Ada &copy;'))
    it('round-trips a display with a code delimiter', () => stable('@Ada `x`'))
    it('round-trips a display with a link bracket', () => stable('@Ada [x]'))
  })
})
