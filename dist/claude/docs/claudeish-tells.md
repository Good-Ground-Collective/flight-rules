# Claudeish Tells

A catalog of the habits that mark text as machine-written. These are not style
preferences. They are fingerprints, and a reader who has seen a few thousand
model outputs recognizes them instantly — usually before finishing the first
paragraph.

Nothing here comes from Google, Apple, or STE100. Those guides describe good
writing. This document describes a specific failure mode none of them anticipated.

Each entry gives the tell, a specimen, and the repair. The repair is never
"delete the sentence" — it is "say the thing plainly."

---

## 1. Sentence constructions

### 1.1 Negation-then-elevation

The single loudest tell. A claim is set up only to be knocked down and replaced
with a grander one.

- **Tell:** `It's not just X — it's Y.` `This isn't merely a parser. It's a contract.`
- **Also:** `X isn't about Y. It's about Z.`
- **Why it fails:** the negated half is filler. The reader never proposed X.
- **Repair:** state Y. `The parser enforces the contract.`

### 1.2 Balanced antithesis

Two clauses of matched length and opposite polarity, arranged for cadence rather
than meaning.

- **Tell:** `not because it's fast, but because it's predictable`
- **Tell:** `less a library than a philosophy`
- **Repair:** keep the half that carries information. `It's predictable.`

### 1.3 The rule of three

Three adjectives, three nouns, three clauses — regardless of whether reality
supplies three.

- **Tell:** `fast, reliable, and maintainable` / `We designed it to be simple, safe, and scalable.`
- **Why it fails:** the third item is almost always padding, and the reader can feel the slot being filled.
- **Repair:** name the one or two attributes that are true and load-bearing.

### 1.4 The rhetorical question fragment

- **Tell:** `The result? A cleaner API.` `Why does this matter? Because state leaks.`
- **Repair:** `The API gets cleaner.` `It matters because state leaks.`

### 1.5 The unearned analogy

An explanatory metaphor nobody asked for, usually introduced by `Think of it as`.

- **Tell:** `Think of the scheduler as an air traffic controller.`
- **Why it fails:** the reader now holds two things in their head instead of one, and the metaphor leaks.
- **Repair:** describe the mechanism. Use an analogy only when the mechanism is genuinely unfamiliar and the analogy genuinely maps.

### 1.6 The definitive closer

A short declarative that awards the preceding paragraph an air of finality.

- **Tell:** `That's the whole trick.` `That's it.` `Simple as that.` `And that's the point.`
- **Repair:** delete. If the paragraph was clear, it does not need a bow on it.

### 1.7 Em dash as default connective

Em dashes used where a comma, period, or colon would do — several times per
paragraph, until the prose develops a distinctive lurching rhythm.

- **Repair:** allow roughly one per few paragraphs. Convert the rest to periods. Two em dashes in one sentence is always wrong.

---

## 2. Openers

| Tell                                                            | Repair                                 |
| --------------------------------------------------------------- | -------------------------------------- |
| `Great question!` / `You're right to flag this.`                | Delete. Answer.                        |
| Restating the question before answering it                      | Delete. Answer.                        |
| `In today's fast-paced world` / `In the world of software`      | Delete.                                |
| `Let's dive in` / `Let's take a look` / `Let's break this down` | Delete. Start.                         |
| `At its core,` / `Fundamentally,` / `Essentially,`              | Delete. The sentence works without it. |
| `Before we begin, let me explain my approach.`                  | Delete. Do the thing.                  |

The shared defect: every one of these is a throat-clear. The paragraph starts
after them, so the paragraph should start where they end.

---

## 3. Closers

| Tell                                                  | Repair                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| A final paragraph restating what the reader just read | Delete it.                                                                         |
| `In summary,` / `To sum up,` / `The bottom line is`   | Delete.                                                                            |
| A `Key Takeaways` section                             | Delete, or promote the takeaways to the top and cut the body that padded them.     |
| `Hope this helps!`                                    | Delete.                                                                            |
| Offering unrequested next steps                       | Delete, unless the next step is genuinely non-obvious and genuinely yours to take. |

A document that needs a summary of itself is a document that buried its point.
Fix the burial, not the ending.

---

## 4. Vocabulary

These words are not forbidden by any external style guide. They are flagged
because their frequency in model output is orders of magnitude above their
frequency in human technical writing.

**Elevated verbs:** delve, leverage, utilize, harness, unlock, empower, elevate,
streamline, foster, underscore, showcase, navigate (figurative), embark.

**Inflated adjectives:** robust, seamless, comprehensive, holistic, nuanced,
intricate, pivotal, crucial, vital, powerful, elegant, sophisticated,
cutting-edge, game-changing, rich (of features), deep (of understanding).

**Abstraction nouns:** landscape, realm, tapestry, testament, ecosystem (outside
its literal sense), journey, space (as in "the observability space"), lens
(figurative), paradigm.

**Bloated connectives:** `when it comes to`, `in terms of`, `with respect to`,
`in the context of`, `as it relates to`, `at the end of the day`.

**Stock phrases:** `a testament to`, `plays a crucial role in`, `serves as a`,
`is designed to`, `it's worth noting that`, `it's important to remember that`,
`this is where X comes in`, `the beauty of X is`.

Repair in every case: name the thing. `leverage the cache` is `use the cache`.
`a robust solution` is either `it handles malformed input` or it is nothing.
`plays a crucial role in authentication` is `it signs the token`.

---

## 5. Hedging

### 5.1 Stacked hedges

Two or more uncertainty markers on one claim.

- **Tell:** `may potentially`, `might possibly`, `could arguably`, `it seems likely that it may`
- **Repair:** one hedge maximum, and only when the uncertainty is real. `may` alone.

### 5.2 Ritual qualification

- **Tell:** `It's worth noting that`, `It's important to remember that`, `That said,`, `However, it's important to note that`
- **Repair:** delete the frame and keep the claim. If the claim doesn't survive on its own, it wasn't worth noting.

### 5.3 Confidence laundering

Hedging a claim you have actually verified, to avoid being wrong.

- **Tell:** `This should probably work` about code you ran and watched pass.
- **Repair:** say what you observed. `The suite passes; I ran it.`

The inverse is equally a tell: stating an unverified guess in the flat register
of fact. Calibrate the language to the evidence in both directions.

---

## 6. Structure

- **A heading over every two sentences.** Headings are for navigation. A section a reader can see the end of without scrolling does not need a signpost.
- **Bold lead-ins on bullets that are secretly paragraphs.** `**Performance:** The system caches aggressively, which means...` — this is a paragraph wearing a bullet's clothes. Either shorten it to a real list item or make it prose.
- **Bullets where prose belongs.** Lists fragment reasoning. If the items connect to each other, they are sentences, not bullets.
- **A list with one item.** Not a list.
- **A table with two rows and two columns.** A sentence.
- **Nesting three levels deep.** Restructure; the hierarchy is doing thinking the prose should do.
- **Emoji in headings.** ✅ ❌ 🚀 — never in technical artifacts.
- **Bold scattered mid-paragraph for emphasis.** Emphasis that appears four times per paragraph is not emphasis.
- **Horizontal rules between every section.** Headings already separate sections.
- **Uniform bullet lengths.** Real lists are ragged, because real items differ in weight. Suspiciously even bullets signal generated filler.

---

## 7. Register

- **Enthusiasm the content hasn't earned.** `This is a great pattern!` about an ordinary factory function.
- **Sycophancy.** Opening by praising the question, the idea, or the user's insight.
- **Serial apology.** One correction, stated once, is enough. See also the self-correction discipline: fix it and move on.
- **Narrating the work.** `I've structured this into three sections.` `Now let me walk through each one.` The structure is visible; announcing it wastes the reader's first sentence.
- **Symmetric scaffolding.** `First… Second… Finally…` imposed on material that has no inherent sequence.

---

## 8. Quick scan list

Grep-able tokens. A hit is not automatically a defect, but every hit deserves a
look.

```
delve  leverage  utilize  robust  seamless  comprehensive  holistic  nuanced
intricate  pivotal  crucial  vital  landscape  realm  tapestry  testament
underscore  foster  harness  unlock  empower  elevate  streamline  showcase
cutting-edge  game-changing  paradigm  ecosystem  journey
it's not just  isn't merely  it's about  not because  rather than merely
think of it as  that's the whole  that's it  simple as that
let's dive  let's take a look  let's break  at its core  fundamentally
essentially  in today's  it's worth noting  it's important to note
that said  when it comes to  in terms of  at the end of the day
in summary  to sum up  the bottom line  key takeaways  hope this helps
a testament to  plays a crucial role  this is where  the beauty of
may potentially  might possibly  could arguably
```
