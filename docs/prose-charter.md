# Prose Standards

These are mandates, not preferences. Violations are reviewable findings.

They govern human-readable artifacts: RFCs, tickets, design docs, READMEs, PR
descriptions, release notes, runbooks, and commit bodies. They do not govern
source code.

W-1 and W-2 lead because they subsume most of the rest. When a later mandate
seems to conflict with them, they win.

---

## W-1 — One word, one meaning

Pick one term for a concept and use that exact term, with that exact
capitalization, every time it appears. Never vary a term for elegance. Never let
one word carry two meanings in the same document.

Banned: calling the same thing a `job`, then a `task`, then a `run`, then a
`workload`. Banned: using `service` to mean both an HTTP server and a class with
injected dependencies.

**Why:** synonym variation forces the reader to ask "is this the same thing?" at
every substitution. That question is pure tax, and the reader pays it silently.
Variation that reads as sophisticated to the writer reads as ambiguity to
everyone else.

This is the load-bearing idea taken from ASD-STE100, whose controlled vocabulary
exists for exactly this reason: in a maintenance procedure, an ambiguous word
kills someone.

## W-2 — Race to simplicity

The shortest version that is still true wins. Always.

When two phrasings say the same thing, take the shorter one. When a sentence
survives having a clause cut, cut it. When a paragraph survives having its first
sentence cut, cut it — it was a throat-clear.

Banned: `in order to` for `to`. `utilize` for `use`. `at this point in time` for
`now`. `has the ability to` for `can`. `allows you to` for `lets you`.

**Why:** length in technical prose is almost never a signal of rigor. It is a
signal that the writer stopped editing. Every word the reader doesn't need is a
word standing in front of one they do.

**The test:** read the sentence, delete a word, read it again. If nothing was
lost, the word was never earning its place.

## W-3 — Active voice, present tense

The grammatical subject performs the action. Behavior is described in the
present.

- Write: `The scheduler retries the job.` Not: `The job is retried.`
- Write: `The server returns 409.` Not: `The server will return 409.`

Passive voice is permitted in three cases and no others: the object genuinely
matters more than the actor (`The file is saved.`), naming the actor would
assign blame unhelpfully (`Over 50 conflicts were found.`), or the actor is
genuinely irrelevant (`The database was purged in January.`).

Never use hypothetical `would`.

**Why:** passive voice hides who acts. In a runbook or an RFC, who acts is
usually the most important fact in the sentence.

## W-4 — Address the reader as "you"

Second person, imperative for instructions. Establish who `you` is early and
hold it.

`We` is permitted only when it names a specific, already-identified group — a
team, an organization. `We` meaning "the reader and I, companionably" is banned,
as is every `Let's` construction.

**Why:** `you` forces the writer to know who they are writing for. Prose that
avoids `you` usually avoids it because the author never decided.

## W-5 — One idea per sentence, 25 words maximum

A sentence carries one idea. Sentences run under 25 words. Paragraphs run under
six sentences and carry one idea.

Banned: double negatives. Banned: exceptions nested inside exceptions.

- Write: `You can continue without a path.`
- Not: `A missing path won't prevent you from continuing.`

Two clauses joined by an em dash and a semicolon are two sentences wearing a
disguise. Split them.

**Why:** comprehension falls off a cliff past roughly 25 words, and it falls
hardest for readers whose first language isn't English — which, on any real
engineering team, is a large share of the audience.

## W-6 — Front-load the point

The first sentence of a document states its conclusion. The first sentence of a
paragraph states the paragraph's point. Conditions come before instructions, so a
reader can skip what doesn't apply to them.

- Write: `To delete the document, click Delete.` Not: `Click Delete if you want to delete the document.`
- Write: `For more information, see the runbook.` Not: `See the runbook for more information.`

Banned: building to a conclusion. This is technical writing, not a mystery.

**Why:** readers scan. A point held until the end is a point most of your
audience never reads.

## W-7 — No Claudeish

Machine-writing tells are defects. The full catalog is
`claudeish-tells.md`; read it in full, every time. The headline offenders:

- `It's not just X — it's Y` and every negation-then-elevation construction
- The rule of three, applied to reality that supplies two
- `delve`, `leverage`, `robust`, `seamless`, `comprehensive`, `crucial`, `landscape`, `testament`, `underscore`
- `Let's dive in`, `At its core`, `It's worth noting that`, `That said`
- A closing paragraph that restates the document
- Em dash as the default connective, several per paragraph
- Emoji in headings; bold scattered through paragraphs for emphasis

**Why:** these constructions are not merely ugly. They are recognizable, and a
reader who recognizes them stops trusting the document's authorship — which
means they stop trusting its claims.

## W-8 — Structure earns its keep

Every structural element justifies itself or gets deleted.

- A heading requires a section long enough to need navigating. Two sentences do not.
- A list requires at least two genuinely parallel items. A one-item list is a sentence.
- A table requires each row to carry three or more fields. Two columns and two rows is a sentence.
- A note or callout requires information that is genuinely optional. Anything required for success belongs in the body.
- Bullets require items that don't depend on each other. Reasoning that connects is prose.

Banned: bold lead-ins on bullets that are really paragraphs. Banned: nesting past
two levels. Banned: horizontal rules between every section.

**Why:** structure is a promise about the shape of the content. Structure applied
to content that doesn't have that shape is a lie, and it makes the document
harder to read than the plain paragraphs it replaced.

## W-9 — Hedge once, or not at all

One uncertainty marker per claim. Stacked hedges (`may potentially`, `might
possibly`, `could arguably`) are banned.

Match the language to the evidence in both directions. A verified result is
stated flatly: `The suite passes.` An unverified guess is marked as one: `I
expect this fixes it; I haven't run it.` Hedging something you confirmed is as
much a defect as asserting something you didn't.

Banned framings: `It's worth noting that`, `It's important to remember that`,
`It should be mentioned that`. Delete the frame, keep the claim.

**Why:** hedges are a currency. Spend them on real uncertainty and they inform.
Spend them everywhere and they tell the reader nothing except that the writer
wants deniability.

## W-10 — Concrete over abstract

Name the thing. Give the number. Quote the error.

- Write: `Auth fails with 401 when the clock skews past 5 minutes.`
- Not: `There are some potential issues with the authentication flow under certain conditions.`

Banned as standalone claims: `robust`, `scalable`, `performant`, `flexible`,
`powerful`, `elegant`. Each is either a measurable claim — in which case state
the measurement — or it is nothing.

Don't attribute human faculties to software. The service `detects`, not `sees`.
The config `specifies`, not `tells`.

**Why:** abstraction is where imprecise thinking hides. Forcing the concrete
version usually reveals whether the writer actually knows.

## W-11 — No claims of ease, no superlatives

Banned: `simply`, `just`, `easy`, `easily`, `quickly`, `straightforward`, `of
course`, `obviously`, `all you need to do is`.

Banned: `best`, `fastest`, `simplest`, `always`, `never`, `guarantee`, `ensure`,
`prevents` — unless you can point at the evidence. Security features `help
protect against`; they do not `prevent`.

**Why:** when a reader who is stuck reads `simply`, the document has told them
their difficulty is a personal failing. That is the opposite of help. And a
superlative you can't source is a claim that ages into a falsehood.

## W-12 — Write for later, and for elsewhere

Describe the current state. No history, no roadmap, no relative age.

Banned: `currently`, `now`, `presently`, `soon`, `eventually`, `new`, `newer`,
`latest`, `recently`, `as of this writing`, `in the future`. If a version
genuinely matters, name it: `the 1.28.0 release`.

Banned: directional language — `above`, `below`, `the panel on the right`. Layout
reverses in right-to-left locales and means nothing to a screen reader. Use
`preceding`, `following`, `earlier`, `later`.

Banned: idioms, colloquialisms, sports metaphors, seasons, holidays, humor, and
pop-culture references. They translate badly or not at all.

Release notes, changelogs, and blog posts are exempt from the time rule — being
anchored in time is their function.

**Why:** documentation outlives the moment it was written in, and it is read by
people who don't share the writer's location, calendar, or first language.

## W-13 — Inclusive and accessible by default

Use `allowlist`/`denylist`, `primary`/`replica`, `person-hours`, `placeholder`,
`final check`. Never `blacklist`/`whitelist`, `master`/`slave`, `man-hours`,
`dummy`, `sanity check`.

Never use disability as metaphor: `crazy`, `insane`, `dumb`, `cripple`, `blind
to`, `tone-deaf`. Say what you mean instead.

Use singular `they`. Never gendered pronouns as generics, and never a pronoun
inferred from a name.

Link text must make sense read alone. Never `click here` or `this document`. Put
the meaningful words first.

Define every acronym on first use. No all-caps or camel case in prose — screen
readers spell them out letter by letter.

**Why:** these are correctness requirements, not courtesies. A document that
excludes part of its audience has failed at its only job.

## W-14 — Preserve the author's voice

In rewrite mode, fix violations. Do not impose a house personality.

An author's rhythm, humor that lands, an unusual but precise word choice, a
deliberately blunt sentence — these are not defects. Leave them. Idiosyncrasy is
the main evidence a human wrote the document, which is the entire point.

The test before every edit: **which mandate does this change enforce?** If the
answer is "none, it just sounds better to me," revert it. Every change in a
rewrite carries a citation. Changes that cannot cite a mandate do not ship.

**Why:** an editor who rewrites everything into one register produces exactly the
homogenized prose this charter exists to prevent. Over-editing and Claudeish are
the same failure arriving from opposite directions.
