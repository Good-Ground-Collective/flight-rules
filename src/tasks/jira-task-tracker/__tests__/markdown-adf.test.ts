import { describe, it, expect } from 'vitest'
import { markdownAdfConverter } from '../markdown-adf.js'
import type { AdfNode } from '../adf.js'

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
  const cases: Array<[string, string]> = [
    ['heading', '## Solution'],
    ['paragraph with marks', 'Ship **now** via `npm run build` today'],
    ['inline link', 'Read the [changelog](https://example.com/CHANGELOG.md) first'],
    ['link at end of line', 'Full diff: [PR #42](https://github.com/o/r/pull/42)'],
    ['bold link label', 'Merged in [**#42**](https://github.com/o/r/pull/42) yesterday'],
    ['code block with language', '```ts\nconst x = 1\nexport { x }\n```'],
    ['code block without language', '```\nplain text\n```'],
    ['task list', '- [ ] verifiable condition\n- [x] already done'],
    ['bullet list', '- first\n- second'],
    ['ordered list', '1. first\n2. second'],
    ['ordered list with a start offset', '3. third\n4. fourth'],
    ['loose bullet list', '- first\n\n- second'],
    ['loose ordered list keeps numbering', '1. first\n\n2. second'],
    ['rule', '---'],
    ['multi-line paragraph', 'line one\nline two'],
    ['emphasis', 'Ship *now* today'],
    ['bold italic', 'Ship ***now*** today'],
    ['strikethrough', 'Drop ~~this~~ instead'],
    ['code then emphasis', 'Run `npm test` then *retry*'],
    ['marks inside a code span stay literal', 'Use `a *b* ~~c~~ **d**` verbatim'],
    ['link', 'See [the docs](https://x.dev) first'],
    ['link with title', 'See [the docs](https://x.dev "Docs") first'],
    ['bold link text', 'See [**the docs**](https://x.dev)'],
    ['bold around a link', 'See **[the docs](https://x.dev)**'],
    ['code link text', 'See [`flight-rules check`](https://x.dev)'],
    ['strike around bold', 'Was ~~**required**~~ now optional'],
    ['heading with marks', '## Ship *it* **now**'],
    ['intraword underscore stays literal', 'the max_retry_count field'],
    ['nested bullets', '- outer\n  - inner\n- second outer'],
    ['deeply nested bullets', '- a\n  - b\n    - c'],
    ['bullet with a nested ordered list', '- outer\n  1. one\n  2. two'],
    ['ordered with a nested bullet list', '1. outer\n   - inner'],
    ['nested bullet carrying marks', '- outer\n  - inner **bold** and `code`'],
    [
      'bullet list nested inside a details block',
      '<details><summary>Guided Walkthrough</summary>\n\n- outer\n  - inner\n\n</details>',
    ],
    ['literal image', '![a](https://x.dev/a.png)'],
    ['literal table', '| A |\n| --- |\n| 1 |'],
    ['literal blockquote', '> quoted line'],
    ['details block', '<details><summary>Guided Walkthrough</summary>\n\nDo the thing.\n\n</details>'],
    [
      'details containing a fenced code block',
      '<details><summary>Guided Walkthrough</summary>\n\nRun this:\n\n```sh\nnpm test\n```\n\n</details>',
    ],
    [
      'nested details',
      '<details><summary>Outer</summary>\n\n<details><summary>Inner</summary>\n\ndeep\n\n</details>\n\n</details>',
    ],
  ]

  it.each(cases)('round-trips a %s byte-equivalently', (_name, markdown) => {
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

describe('markdownAdfConverter.toMarkdown graceful degradation', () => {
  it('flattens unknown block nodes to their text content', () => {
    const nodes: AdfNode[] = [
      {
        type: 'panel',
        attrs: { panelType: 'info' },
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
