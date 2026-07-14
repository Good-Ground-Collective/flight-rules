import { describe, it, expect } from 'vitest'
import { adfToMarkdown, markdownToAdf } from './markdown-adf.js'
import type { AdfNode } from './adf.js'

const roundTrip = (markdown: string): string => adfToMarkdown(markdownToAdf(markdown).content)

describe('markdownToAdf', () => {
  it('converts a heading to a heading node with its level', () => {
    const doc = markdownToAdf('## Problem Statement')
    expect(doc.content).toEqual([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Problem Statement' }] },
    ])
  })

  it('converts bold and inline code to marked text nodes', () => {
    const doc = markdownToAdf('Run **all** the `flight-rules check` command')
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

  it('converts a fenced code block to a codeBlock with its language', () => {
    const doc = markdownToAdf('```ts\nconst x = 1\n```')
    expect(doc.content).toEqual([
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const x = 1' }] },
    ])
  })

  it('converts checkboxes to a taskList with TODO/DONE states', () => {
    const doc = markdownToAdf('- [ ] first\n- [x] second')
    const [taskList] = doc.content
    expect(taskList?.type).toBe('taskList')
    expect(taskList?.content?.map((item) => item.attrs?.['state'])).toEqual(['TODO', 'DONE'])
    expect(taskList?.content?.[0]?.content).toEqual([{ type: 'text', text: 'first' }])
  })

  it('converts bullets to a bulletList of listItem paragraphs', () => {
    const doc = markdownToAdf('- one\n- two')
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
    const doc = markdownToAdf('<details><summary>Guided Walkthrough</summary>\n\nStep one.\n\n</details>')
    expect(doc.content).toEqual([
      {
        type: 'expand',
        attrs: { title: 'Guided Walkthrough' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step one.' }] }],
      },
    ])
  })

  it('handles a <summary> on its own line (LLM Context form)', () => {
    const doc = markdownToAdf('<details>\n<summary>LLM Context</summary>\n\n```yaml\nnotes: hi\n```\n\n</details>')
    const [expand] = doc.content
    expect(expand?.attrs).toEqual({ title: 'LLM Context' })
    expect(expand?.content?.some((n) => n.type === 'codeBlock')).toBe(true)
  })

  it('produces an empty doc for an empty body', () => {
    expect(markdownToAdf('').content).toEqual([])
  })
})

describe('markdown ⇄ ADF round-trip', () => {
  const cases: Array<[string, string]> = [
    ['heading', '## Solution'],
    ['paragraph with marks', 'Ship **now** via `npm run build` today'],
    ['code block with language', '```ts\nconst x = 1\nexport { x }\n```'],
    ['code block without language', '```\nplain text\n```'],
    ['task list', '- [ ] verifiable condition\n- [x] already done'],
    ['bullet list', '- first\n- second'],
    ['multi-line paragraph', 'line one\nline two'],
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
      'markdownToAdf(body)',
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

describe('adfToMarkdown graceful degradation', () => {
  it('flattens unknown block nodes to their text content', () => {
    const nodes: AdfNode[] = [
      {
        type: 'panel',
        attrs: { panelType: 'info' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'from the UI' }] }],
      },
    ]
    expect(adfToMarkdown(nodes)).toBe('from the UI')
  })

  it('renders link marks as markdown links', () => {
    const nodes: AdfNode[] = [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'docs', marks: [{ type: 'link', attrs: { href: 'https://x.dev' } }] }],
      },
    ]
    expect(adfToMarkdown(nodes)).toBe('[docs](https://x.dev)')
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
    expect(adfToMarkdown(nodes)).toBe('1. one\n2. two')
  })
})
