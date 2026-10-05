import { z } from 'zod';
import type { AdfDocNode, AdfNode } from './adf.js';
/**
 * One uploaded attachment addressed by its media-services UUID. `collection` is
 * the empty string for a Jira issue (Jira normalizes any other value on save),
 * and `width`/`height` are supplied when the upload path knows the image's pixel
 * dimensions, which Atlassian requires for the media to render.
 */
export declare const MediaRefSchema: z.ZodObject<{
    mediaUuid: z.ZodString;
    collection: z.ZodDefault<z.ZodString>;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
/** Attachments keyed by filename, the human-legible key that survives a read-modify-write. */
export declare const MediaLookupSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    mediaUuid: z.ZodString;
    collection: z.ZodDefault<z.ZodString>;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>>;
export type MediaRef = z.infer<typeof MediaRefSchema>;
export type MediaLookup = z.infer<typeof MediaLookupSchema>;
export interface MarkdownAdfConverter {
    toAdf(markdown: string, media?: MediaLookup): AdfDocNode;
    toMarkdown(nodes: AdfNode[], media?: MediaLookup): string;
}
/**
 * Bidirectional markdown ⇄ ADF conversion for the layered-body subset
 * (docs/layered-body-format.md): headings, paragraphs with emphasis / strong /
 * strikethrough / code / link marks, fenced code blocks, task lists, nested
 * bullet and ordered lists, thematic breaks, and `<details>` blocks (mapped to
 * ADF expands). The write direction parses with `mdast-util-from-markdown` plus
 * the GFM extensions and maps mdast nodes to ADF in a `switch` on `node.type`;
 * the read direction is a hand-written emitter, kept off mdast so `*`/`_` are
 * never over-escaped. mdast nests marks where ADF flattens them onto one text
 * node, so the emitter coalesces each text node's stored (outermost-first) marks
 * into shared spans — opening a delimiter when a mark first applies across
 * adjacent nodes and closing it only once it stops — which keeps a link inside
 * or outside a bold consistent with how it was authored and avoids re-opening a
 * span per node. GFM tables, blockquotes, and GitHub admonitions map to ADF
 * `table`, `blockquote`, and `panel`; because those content models are narrower
 * than GFM's (a blockquote rejects headings and nested quotes, a panel rejects
 * code blocks, a cell holds one paragraph), disallowed children degrade to
 * literal paragraph text sliced from source so the ADF stays schema-valid and the
 * markdown round-trips. A paragraph that is a single image whose target resolves
 * in the optional `MediaLookup` (keyed by filename, or matched by media UUID)
 * becomes a `mediaSingle > media` node so an uploaded attachment renders inline,
 * and reads back to an `![alt](attachment:<filename>)` reference, degrading to the
 * UUID when the lookup is empty; an external or unresolved image stays literal
 * text. Unknown ADF nodes flatten to their text on read. A
 * `@{accountId|Display Name}` token in inline text becomes an ADF `mention` node
 * and back; identity is resolved outside the converter, so the display written is
 * only a hint.
 */
export declare class LayeredBodyAdfConverter implements MarkdownAdfConverter {
    toAdf(markdown: string, media?: MediaLookup): AdfDocNode;
    toMarkdown(nodes: AdfNode[], media?: MediaLookup): string;
    private render;
    private parse;
    /**
     * Maps a run of sibling mdast blocks to ADF. `allowed`, when a container passes
     * it, restricts the output to that container's content model: a node whose ADF
     * type falls outside the set degrades to literal paragraph text rather than an
     * invalid child. `media` only reaches the block mapper at the document level
     * (`allowMedia`): a `mediaSingle` is valid ADF as a top-level block but not
     * inside a panel, blockquote, list item, or table cell, so nested runs resolve
     * no attachments and an image there stays literal.
     */
    private blocks;
    private blockNode;
    /**
     * A paragraph that holds a single image becomes an inline `mediaSingle > media`
     * node when its target resolves in the lookup, so an uploaded attachment renders
     * where the reader is looking. Returns undefined for anything else — an image
     * mid-sentence, or an unresolved target — leaving the paragraph to map its image
     * to literal text. `layout` is required by ADF; `alt` is emitted for Jira's own
     * example even though it is undocumented, and `width`/`height` only when known.
     */
    private mediaSingle;
    /**
     * Resolves an image target to an uploaded attachment, or undefined to leave the
     * image literal. An `attachment:` marker addresses an attachment directly — by
     * exact media UUID first, then by filename — and is never treated as external.
     * Any other URL scheme (or a protocol-relative `//`) is a genuine external image
     * and resolves to nothing, so a lookup keyed by filename cannot hijack
     * `https://host/before.png`. A bare local path resolves by basename.
     */
    private resolveMedia;
    private mediaByUuid;
    /** Looks up a target's basename as an OWN entry, so inherited names (`constructor`, `__proto__`) never resolve. */
    private mediaByName;
    /** The ADF block type an mdast node maps to, or `''` when it only degrades to literal text. */
    private adfType;
    private listAdfType;
    /**
     * A blockquote whose first paragraph opens with a `[!TYPE]` marker is a GitHub
     * admonition and maps to an ADF `panel` — but only when its remaining blocks all
     * fit the panel content model. A code fence (or anything else a panel rejects)
     * forces the plain-`blockquote` fallback, which keeps the marker as literal text
     * in the first paragraph. A blockquote with no marker maps straight to
     * `blockquote`, its own disallowed children (headings, nested quotes) degrading.
     */
    private quoteOrPanel;
    /**
     * ADF's `panel` and `blockquote` content models require at least one child, so a
     * marker-only alert or a bare `>` (which leave no body) get an empty paragraph
     * rather than an empty, schema-invalid container.
     */
    private withBlockContent;
    private alertType;
    /**
     * Returns the blockquote's children with the admonition marker (and its trailing
     * newline) removed from the first paragraph, dropping that paragraph when nothing
     * but the marker remained. mdast keeps the marker and the first body line in one
     * text node when no blank `>` line separates them, so only the leading text is rewritten.
     */
    private stripAlertMarker;
    /**
     * mdast tables carry phrasing cells and per-column alignment; ADF cells hold
     * block content and cannot express alignment, so each cell becomes a single
     * paragraph, the first row's cells become `tableHeader`, and `node.align` is
     * dropped. An empty cell keeps an empty paragraph so every cell has block content.
     */
    private table;
    /**
     * Re-pairs a `<details>`/`</details>` run of sibling blocks into a single
     * expand. `mdast-util-from-markdown` emits an `html` node for each opener and
     * closer with the inner markdown as ordinary siblings between them, so this
     * scans forward counting nesting depth on those html nodes. The `<summary>`
     * (which shares the opener's html node) becomes the title; if the author left
     * content after `</summary>` on the same html block instead of a blank line,
     * that remainder is parsed and prepended to the inner blocks. An unclosed run
     * returns undefined so the caller degrades the opener to literal text.
     *
     * `expandDepth` is 0 only when this `<details>` is a direct child of the
     * document, because ADF allows an `expand` only at the document top level —
     * never inside a list item, quote, panel, or another expand. So a top-level
     * `<details>` becomes an `expand`, and any nested `<details>` flattens to a
     * bold-titled run of its body — schema-valid content the top-level expand's
     * broad model accepts, rather than the misplaced expand it used to emit, which
     * Jira rejects outright.
     */
    private pairDetails;
    private listNodes;
    private singleList;
    /**
     * Coerces block content into a `listItem`'s content model, filling an empty item
     * with a paragraph. See {@link coerceListItemBlock} for the per-block rule.
     */
    private restrictToListItem;
    /**
     * Reshapes one block into what a `listItem` may hold, preserving inline nodes —
     * mention identity above all. A heading becomes a paragraph of its inline
     * content; a quote, panel, or table unwraps to its own (already listItem-valid)
     * inner blocks rather than being re-serialized to markdown, which would flatten a
     * mention into literal `@{…}` text that later exports re-escape into corruption; a
     * rule drops, having no list-item form. Paragraphs, code blocks, and nested lists
     * pass straight through.
     */
    private coerceListItemBlock;
    /**
     * ADF's `taskItem` is inline-only, so each item takes just the inline content
     * of its leading paragraph. A task item's remaining blocks (a nested list or a
     * continuation paragraph) can't live inside the taskItem or nest a list within
     * it — both are invalid ADF — so they spill out as sibling blocks after the
     * taskList, preserving the content without corrupting the flat-checklist case
     * that gets posted to Jira. Round-trip stays valid; the rare nested case flattens.
     */
    private taskList;
    private inline;
    /**
     * Splits a text value on soft line breaks. mdast keeps a soft break as a `\n`
     * inside one `text` node, but today's ADF interleaves `hardBreak` nodes and
     * the multi-line-paragraph round-trip depends on that. An empty segment — from a
     * value that leads or trails with the break, e.g. a mention starting a line —
     * emits only its hardBreak, never an empty `text` node, which ADF rejects.
     */
    private textSegments;
    /**
     * Splits `@{accountId|Display Name}` tokens out of an inline text node into
     * `mention` nodes. Detection runs over the raw source slice, because only the
     * source tells an escaped `\@{…}` (and an entity-encoded `&#64;{…}`, which never
     * matches the literal-`@` token) from a real mention; mdast's decoded value
     * collapses all three to `@{…}`, so pairing decoded matches to source ones by
     * order would hand an escape flag to the wrong token. The surrounding text and
     * the split points come from the decoded `value` instead: each real mention's
     * decoded token (`@{id|display}`, rebuilt with the same `decodeString` mdast
     * applied) is located in `value` in order, and the text between tokens is
     * emitted straight from `value`, so a container marker that survives in the
     * source slice — a blockquote's `> ` continuation, an alert's stripped
     * `[!TYPE]` — never leaks into the text. An escaped token, or a pipe-less
     * `@{Name}`, stays literal text; the id resolves identity, and mentions never
     * carry marks.
     */
    private mentionSegments;
    /** Non-overlapping occurrences of `needle` in `haystack`. */
    private countOccurrences;
    /**
     * The original source-space split, kept for the rare text node where the decoded
     * value carries a literal identical to a real mention (an escaped or entity token).
     * It emits the surrounding text from the source slice, so a container marker there
     * can leak — the same, pre-existing behaviour — but escape, entity, and order stay
     * exact, which matters more than a marker in that corner.
     */
    private mentionSegmentsFromSource;
    /** A token is escaped when an odd run of backslashes precedes its `@`. */
    private isEscaped;
    private mention;
    /**
     * The canonical mention token `@{accountId|Display Name}`. The pipe is
     * required so a literal `@{Name}` stays text, and the display admits `\`
     * escapes so a display carrying a brace or markdown delimiter round-trips.
     * Built fresh per call because the `g` flag carries `lastIndex` and the inline
     * walk recurses.
     */
    private mentionToken;
    /**
     * Degrades an unmappable block to a literal paragraph of its source text. When
     * demoted into a container that re-quotes its body (a blockquote), the outer
     * `> ` on each continuation line belongs to the enclosing quote, not the child —
     * mdast strips it from the first line only — so `stripEnclosingQuote` removes one
     * quote level from the rest. Otherwise a nested quote, quoted table, or quoted
     * task list would accrete a `>` on every round trip.
     */
    private literalBlock;
    private stripEnclosingQuote;
    private literal;
    private blockToMarkdown;
    /**
     * Recovers an image reference from a `media` (or `mediaInline`) node, escaping
     * the alt text and the destination exactly as a link's are so a filename with a
     * space or bracket (a screenshot named `screen shot.png`) survives the round
     * trip. A `type: 'external'` node carries a `url` and reads back as
     * `![alt](url)`; otherwise the filename comes from the inverted lookup and
     * degrades to the media UUID, never to `alt`, which Jira does not always preserve.
     */
    private mediaReference;
    /**
     * Escapes image alt text so `![alt](dest)` re-parses to the same alt: the `]`
     * that would close the description early, `\` itself, the markdown delimiters
     * that would reinterpret the name, and `&` (which would otherwise decode as an
     * entity) each gain a backslash that mdast strips on the way back.
     */
    private encodeAlt;
    /**
     * Joins a container's child blocks. A markdown heading is self-delimiting, so
     * the block after one needs no blank line; every other block gets the usual
     * blank line. That reproduces `> ## x` then `> body` (a heading demoted to
     * literal text inside a quote) and a panel heading followed by a paragraph.
     */
    private containerBody;
    private quoteToMarkdown;
    /**
     * Emits an admonition as `> [!TYPE]` over the quoted body. An unknown panelType
     * has no marker to restore, so it degrades to a plain blockquote.
     */
    private panelToMarkdown;
    /**
     * Emits a GFM table: a header row, a `---` delimiter (alignment is not
     * representable in ADF and is dropped), then the body. The first row is always
     * the header even when its cells read back as `tableCell`.
     */
    private tableToMarkdown;
    /**
     * Flattens a cell's block content to one line: blocks join with a space, a UI
     * cell's internal newlines collapse to spaces, and a literal `|` re-escapes so
     * it survives GFM's cell parse (which unescapes `\|`) instead of splitting the row.
     */
    private cellToMarkdown;
    /**
     * Emits one list item and its nested blocks. ADF holds a nested list as a
     * sibling of the item's paragraph, so a nested list joins onto the item with a
     * single newline while any other block joins with a blank line; continuation
     * lines then indent by the marker width, nesting `- ` at two spaces, `1. ` at
     * three, and `10. ` at four.
     */
    private listItemToMarkdown;
    /**
     * Serializes a text node's marks as coalesced spans rather than wrapping each
     * node independently. Marks are stored outermost-first, so a delimiter opens
     * when a mark first appears across adjacent nodes and closes only once it stops
     * applying to the next node. That keeps a mark spanning several text nodes as a
     * single span (`**before [x](u) after**`) instead of re-opening it per node,
     * which would re-parse to duplicate marks. Text inside a code span is emitted
     * verbatim; all other text is escaped so decoded literals (`literal *x*`)
     * don't re-parse as syntax.
     */
    private inlineToMarkdown;
    private isEmphasis;
    /**
     * Emits a `mention` node as `@{id|display}`, dropping the leading `@` from
     * `attrs.text`, and `@{id|}` when `attrs.text` is absent so the read is Jira's
     * to re-resolve from the id. The display is escaped so the token re-parses
     * atomically instead of losing the mention to markdown inside the name.
     */
    private mentionToMarkdown;
    /**
     * Escapes a display name so `@{id|display}` re-parses as one mention: the
     * `}` terminator, `\` itself, the markdown delimiters that would re-interpret
     * the name, and `&` (which would otherwise decode as an entity) each gain a
     * backslash that `decodeString` strips on the way back.
     */
    private escapeMentionDisplay;
    /**
     * Wraps text in the markdown for one mark, innermost-first. Only used for the
     * rare content-bearing inline node; the main text path coalesces marks instead.
     */
    private applyMark;
    private markOpen;
    private markClose;
    private linkClose;
    private marksEqual;
    /**
     * Collapses a link whose visible text equals its destination to the bare url,
     * but only when the destination needs no escaping and there's no title — so the
     * autolink re-parses to the same href. Otherwise the caller emits `[text](dest)`.
     */
    private tryBareUrl;
    private linkToMarkdown;
    /**
     * Escapes a link destination so it re-parses to the same string: literal `\`
     * and `&` are backslash-escaped (mdast otherwise reads `&copy;` as an entity),
     * and a destination carrying spaces, control chars, or parens is wrapped in
     * `<...>` with its `<`/`>` escaped.
     */
    private encodeDestination;
    /**
     * Escapes a link title emitted inside `"..."`: `\`, `&`, and the `"` delimiter
     * are backslash-escaped so the title re-parses unchanged instead of breaking
     * the link or being read as an entity.
     */
    private encodeTitle;
    /**
     * Escapes literal text so mdast-decoded content doesn't re-parse as syntax:
     * `\`, `*`, and `` ` `` are the markers that would otherwise reinterpret plain
     * text as emphasis or code. Text inside a code span is left verbatim, and
     * characters that only matter at block scope (`[`, `|`, `>`, `!`) stay
     * unescaped so degraded literal blocks round-trip byte-for-byte. Marks like
     * emphasis are emitted via their own delimiters, not through this. A literal
     * text node that itself reads as a mention token (`@{id|name}`) is escaped to
     * `\@{…}` so it re-parses as text rather than a mention.
     */
    private escapeText;
}
export declare const markdownAdfConverter: MarkdownAdfConverter;
