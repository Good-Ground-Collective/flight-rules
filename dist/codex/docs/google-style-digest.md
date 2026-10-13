# Google Developer Documentation Style Guide — Digest

A condensed reference of the Google style guide's prose-craft rulings, for
lookup during a review. This is not the law — `prose-charter.md` is. Consult
this file when a charter mandate needs a specific ruling, an example pair, or a
term-level decision.

Source: <https://developers.google.com/style>. Fetched August 2026. Pages on
HTML/CSS, code samples, API reference comments, product names, trademarks, and
units of measure were deliberately not summarized; they govern markup and
Google-specific naming rather than prose.

---

## 1. Voice and tone

Write as "a knowledgeable friend who understands what the developer wants to
do." Conversational, friendly, respectful. Clear over clever.

**Avoid:** buzzwords, jargon, cutesy language, figurative language, metaphor,
ableist language, placeholder phrases (`please note`, `at this time`), choppy or
long-winded sentences, pop-culture references, exclamation marks, internet slang
(`tl;dr`, `ymmv`), humor, `let's` constructions.

**Avoid repetitive sentence openers.** Several consecutive sentences beginning
`You can` or `To do` read as generated.

**Never claim ease.** `simply`, `it's easy`, `it's that simple`, `quickly`,
`just` — all banned. What is easy for the writer is not easy for the reader, and
the reader who struggles is told the fault is theirs.

**Don't overuse `please`.**

- Recommended: `To view the document, click View.`
- Not recommended: `To view the document, please click View.`

Calibration table from the guide:

| Too informal                                         | Just right                                                   | Too formal                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `Dude! This API is totally awesome!`                 | `This API lets you collect data about what your users like.` | `The API documented by this page may enable the acquisition of information pertaining to user preferences.`                       |
| `Then—BOOM—just garbage-collect, and you're golden.` | `To clean up, call the collectGarbage method.`               | `Please note that completion of the task requires the following prerequisite: executing an automated memory management function.` |

**Technique:** read passages aloud. Ask "what am I trying to say?" when phrasing
is muddled.

---

## 2. Grammar and person

**Active voice.** The grammatical subject performs the action. Passive voice
obscures who acts.

- Recommended: `Send a query to the service. The server sends an acknowledgment.`
- Not recommended: `The service is queried, and an acknowledgment is sent.`

Passive is acceptable in exactly three cases: to emphasize the object over the
actor (`The file is saved.`), to de-emphasize a blameworthy actor (`Over 50
conflicts were found` rather than `You created over 50 conflicts`), or when the
actor is irrelevant (`The database was purged in January.`).

**Present tense.** Describe general behavior in the present.

- Recommended: `The server sends an acknowledgment.`
- Not recommended: `The server will send an acknowledgment.`

Future tense is correct only for genuinely later events (`The file will be
archived the next time the backup runs.`). Never use hypothetical `would`.

**Second person.** Address the reader as `you`. Use the imperative for
instructions (`Click Submit.`). Identify who `you` is early and hold it
consistent. Reserve third person for what the software or an end user does.

`We` / `our` / `us` are acceptable only when the antecedent is an explicitly
named organization.

**Sentence structure.** State the circumstance, condition, or goal _before_ the
instruction, so a reader can skip what doesn't apply.

- Recommended: `To delete the entire document, click Delete.`
- Not recommended: `Click Delete if you want to delete the entire document.`
- Recommended: `For more information, see [link].`
- Not recommended: `See [link] for more information.`

**Sentence length.** Keep sentences under 26 words (from the accessibility
page). Avoid double negatives and nested exceptions.

- Recommended: `You can continue without a path.`
- Not recommended: `A missing path won't prevent you from continuing.`

**Anthropomorphism.** Don't give software human faculties.

- Recommended: `The PC detects a new device.` / `A Delimiter object specifies where to split a string.`
- Not recommended: `The PC sees a new device.` / `A Delimiter object tells the splitter where a string should be broken.`

Replace `sees`, `tells`, `thinks`, `understands`, `wants` with `detects`,
`specifies`, `processes`, `identifies`, `requires`.

**Pronouns.** Every pronoun needs an unambiguous antecedent. Follow `this` and
`these` with a noun.

- Recommended: `Set this value to true.` — Not recommended: `Set this to true.`
- Recommended: `If you type text in the field, the text doesn't change.` — Not recommended: `…it doesn't change.`

Never use gendered pronouns as generics. Use singular `they`.

Keep optional relative pronouns; they aid parsing and translation.

- Recommended: `Right-click the link that you want to open.`
- Not recommended: `Right-click the link you want to open.`

`That` introduces restrictive clauses without a comma. `Which` introduces
nonrestrictive clauses with a comma.

**Articles.** Never drop `a`, `an`, or `the` for brevity, including in headings.

- Recommended: `Create a VM instance` — Not recommended: `Create VM instance`

**Contractions.** Use ordinary ones. Negative contractions (`isn't`, `don't`,
`can't`) are actively preferred, because a scanning reader can miss a standalone
`not`. Avoid nonstandard (`guides're`) and three-word (`mightn't've`) forms.

**Abbreviations.** Spell out on first reference: _Border Gateway Protocol_
(_BGP_). Never use an abbreviation as a verb. No periods in acronyms. Don't use
`i.e.` (write `that is`), `e.g.` (write `for example`), or internet slang.
Prefer rephrasing over `etc.`

Terms that rarely need spelling out: AI, API, HTML, PDF, XML, RAM, REST, URL,
USB, PC, DVD, MB/GB.

---

## 3. Word choice

Rulings drawn from the word list. Left column is what to cut.

| Avoid                                         | Use instead                             |
| --------------------------------------------- | --------------------------------------- |
| `allows you to`                               | `lets you`                              |
| `in order to`                                 | `to`                                    |
| `leverage` (meaning "use")                    | `use`, `build on`                       |
| `utilize`                                     | `use`                                   |
| `commence`                                    | `start`                                 |
| `consequently`                                | `so`                                    |
| `a number of`                                 | `some`, `many`                          |
| `access` (as a verb)                          | `use`, `see`, `edit`, `find`, `view`    |
| `functionality`                               | `features`, `capabilities`              |
| `actionable`                                  | omit                                    |
| `just`, `simply`, `easy`, `easily`, `quickly` | omit                                    |
| `please`, `please note`                       | omit                                    |
| `e.g.` / `i.e.`                               | `for example` / `that is`               |
| `etc.`, `and so on`                           | introduce with `such as` or `including` |
| `aka`                                         | `also known as`                         |
| `for instance`                                | `for example`, `such as`                |
| `could`                                       | `can`                                   |
| `currently`, `now`, `presently`, `at present` | omit                                    |
| `new`, `newer`, `latest`                      | give a version number or date           |
| `soon`, `eventually`, `in the future`         | omit or give a specific date            |
| `copy and paste`                              | describe what to enter                  |

**Excessive claims.** Ban superlatives and absolutes: `best`, `simplest`,
`fastest`, `never`, `always`, `ensure`, `guarantee`. Never claim a feature
`prevents` a security problem — write `helps protect against`. Performance
claims need a verifiable source. Don't compare against named competitors.

**Timeless documentation.** Describe the current state only. No history, no
roadmap, no relative age. If a version genuinely matters, name it: `The January
14, 2021 release of BigQuery includes a resource panel.`

**Jargon.** Ask in order: can you avoid the term? Is there a more specific one?
Used once — define in parentheses. Used repeatedly — define on first reference.
Examples: `blast radius` → `affected area`; `ingest` → `import`, `load`;
`off-the-shelf` → `ready-made`; `post-mortem` → `review`.

**Prescriptive language.** Recommend one path rather than surveying options.

| Meaning          | Word                      |
| ---------------- | ------------------------- |
| Required         | `must`, or the imperative |
| Recommended      | `We recommend`            |
| Optional         | `can`                     |
| Possible outcome | `might`, `can`            |

Avoid `should` — it blurs required and optional.

---

## 4. Global audience

Shorter sentences translate better. Use no more than two nouns as modifiers of a
third. Place modifiers immediately before what they modify (`Request only one
token`, not `Only request one token`).

Don't use one word with two meanings in close proximity. Reuse the exact same
term — including capitalization — for the same concept every time. Standardize
phrasing for recurring tasks.

Repeat words where redundancy aids parsing (`If the VM has started and if you're
able to…`). Keep helper words: `that`, `then`, `of`.

Qualify technical keywords with a noun: `the example.yaml file`, not bare
`example.yaml`.

Cut colloquialisms (`ballpark figure`, `back burner`), idioms, slang, humor,
seasons, holidays, and sports references. Use diverse example names and
unambiguous date formats.

---

## 5. Inclusive and accessible language

**Replace:** `blacklist`/`whitelist` → `denylist`/`allowlist`; `master`/`slave` →
`primary`/`replica` or `controller`/`replica`; `man-hours` → `person-hours`;
`mankind` → `humanity`; `sanity-check` → `final check`; `dummy variable` →
`placeholder`; `hangs` → `stops responding`; `hit` → `click`; `crazy`, `insane`,
`dumb`, `cripple`, `blind to` → precise descriptors.

Avoid `native speaker`, `first-class citizen`, the pets-versus-cattle metaphor.

Use people-first or identity-first phrasing per current guidance: `people with
disabilities`, not `the disabled`; `uses a wheelchair`, not `wheelchair-bound`;
never `victim of` or `suffering from`. Don't use `normal` or `healthy` to mean
nondisabled. Use `older adults`, not `elderly` or `seniors`.

**Accessibility of the prose itself:** break up walls of text; put important
information in opening sentences; define acronyms on first use; use parallel
structure for parallel items; avoid all-caps and camel case in prose; avoid
`&` for `and`.

**No directional language.** Layout reverses in right-to-left locales and means
nothing to a screen reader. Use `preceding`, `following`, `earlier`, `later` —
never `above`, `below`, `on the right`.

**Link text must stand alone.** Never `click here`, `this document`, or a bare
URL. Put the important words first. Introduce with `For more information, see…`.
Use `see`, not `on`, for cross-references.

---

## 6. Structure and formatting

**Headings.** Sentence case. No terminal period. Task headings start with a bare
infinitive (`Create an instance`). Conceptual headings are noun phrases
(`Migration to Google Cloud`). Avoid `-ing` as the first word. One `h1` per
page; never skip levels; never leave a heading empty; never put a link in a
heading. Don't number sections manually. Avoid `this section` — write `the
following sections`.

**Paragraphs.** One idea each, in the fewest sentences possible. More than five
or six sentences usually means the paragraph is carrying too much. Put the
critical detail first — readers don't read every word. Single-sentence
paragraphs are fine. Don't pad sentences to reduce sentence count.

**Lists.** Never a one-item list. Numbered for sequence, bulleted otherwise.
Introduce with a complete sentence, not a fragment the items complete. Use `the
following` as the noun phrase. Keep every item in the same grammatical shape.
Capitalize items; punctuate them only when they contain a verb. Use a table
instead when each entry carries three or more pieces of data.

**Tables.** Justified when each row has three or more related fields. Not for
layout, not for a single row, not for a single column, not mid-procedure. Sentence
case headers, no terminal punctuation. Introduce in the preceding text. No merged
cells.

**Procedures.** Number multi-step procedures; a single step is a bullet. One
action per step. Start each step with an imperative verb. Give the location
before the action (`In Google Docs, click File`), and the purpose before the
action (`To start a new document, click…`). Prefix optional steps with
`Optional:`. Document only the shortest, simplest, most accessible path. Don't
write `run the following command` — say what the command does.

**Notices.** Four kinds: Note (useful, not critical), Caution (proceed
carefully), Warning (don't do this / irreversible), Success (interactive content
only). Use a note only when the information is genuinely optional, doesn't break
the reader's flow, and isn't a continuation of the surrounding text. Never use a
note for a prerequisite, a step, a cross-reference, or anything required for
success. Never stack two notices. Multiple notices on a page destroy the
distinctiveness of all of them.

**Examples.** Introduce with `such as`, `for example`, or `like`. A short example
attaches with a comma, parentheses, or em dash — never a semicolon. A long
example becomes its own sentence.

**Numbers.** Spell out zero through nine and all ordinals (`first`, not `1st`).
Use numerals for 10 and up, and for versions, steps, prices, percentages,
measurements, dimensions, and ranges regardless of size. Rearrange rather than
start a sentence with a numeral.

---

## 7. Punctuation

**Em dash.** Marks a break or interruption. No spaces around it. Don't substitute
a hyphen or en dash. Never use it as an item/description separator — use a colon.

**En dash.** Don't use. Use a hyphen or the word `to`.

**Semicolon.** Avoid where possible. Three legitimate uses: joining two closely
related independent clauses, preceding a conjunctive adverb (`; therefore,`), and
separating list items that contain their own commas.

**Colon.** The text before it must be a complete sentence.

- Recommended: `The fields are defined as follows:` — Not recommended: `The fields are:`

Lowercase the first word after a colon, unless it's a proper noun, heading, or
quotation.

**Comma.** Use the serial comma. Comma after an introductory phrase. Comma before
a coordinating conjunction joining two independent clauses, unless both are very
short. Comma before nonrestrictive `which`, none before restrictive `that`.

**Parentheses.** Some readers skip them entirely, so nothing important goes
inside. Keep parentheticals short; a long one becomes its own sentence. A
complete sentence inside parentheses takes its period inside.

**Periods.** End every complete sentence except in lists and headings. One space
between sentences. Don't end a sentence with a URL.

**Exclamation marks.** Never in concept, reference, or procedural docs.

**Quotation marks.** Rare in technical writing. Straight, never curly. Commas and
periods go inside — except around literal strings, where exact syntax must be
preserved.

**Hyphens.** Hyphenate compound modifiers before a noun (`well-designed app`).
Don't hyphenate `-ly` adverbs. Generally no hyphen after a prefix, except with
`self-`, `cross-`, before a capital or numeral, or where it prevents misreading
(`re-mark`). Closed forms: `webpage`, `hostname`, `tradeoff`, `workaround`.
Hyphens for ranges (`8-20 files`), never en dashes.

**Capitalization.** Standard American English. Sentence case for headings,
titles, list items, table cells, and captions. No all-caps or camel case except
in official names or literal code. Don't lean on capitalization to carry meaning.
